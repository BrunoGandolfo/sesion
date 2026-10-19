"""
Los trabajos durables que la app le entrega al worker por
GET /api/trabajos/pendientes: borrar el transcript en AssemblyAI, generar
"Para vos" e integrar la sesion al Recorrido. Cada uno devuelve el payload de
POST /api/trabajos/[id]/resultado. No comparten estado con el pipeline de
sesion (processor.py): los llama worker.py por separado.

Privacidad de logs: solo ids, conteos, codigos y status.
"""
import json
from datetime import date
from pathlib import Path
from typing import Callable

import asr_assemblyai
import clinical_analyzer
import config
from clinical_analyzer import MODELO_LLM
from errores import PipelineError
from schemas_llm import validar_recorrido
from uso import Uso


def ejecutar_trabajo(trabajo: dict) -> dict:
    """
    Ejecuta un trabajo entregado por GET /api/trabajos/pendientes y devuelve
    el payload para POST /api/trabajos/[id]/resultado ({ok: true, ...} o
    {ok: false, error, definitivo}), siempre con `uso`. Nunca lanza.
    """
    tipo = trabajo.get("tipo")
    uso = Uso()
    try:
        with uso.medir(str(tipo)):
            ejecutor = EJECUTORES.get(tipo)
            if ejecutor is None:
                # Un worker viejo durante un deploy: lo toma otro que lo conozca.
                resultado = _fallo_trabajo(f"tipo no soportado: {tipo}", definitivo=False)
            else:
                resultado = ejecutor(trabajo, uso)
    except Exception as e:
        resultado = _fallo_trabajo(_describir(e), definitivo=isinstance(e, PipelineError) and e.definitivo)
    return {**resultado, "uso": uso.payload()}


def _fallo_trabajo(error: str, *, definitivo: bool) -> dict:
    """
    {ok: false} de un trabajo. `definitivo`: repetirlo da lo mismo (y si hubo
    modelo, lo paga de nuevo); la app deja de reintentar. Mismo criterio que
    en las sesiones: errores.CODIGOS_DEFINITIVOS.
    """
    return {"ok": False, "error": error[:500], "definitivo": definitivo}


# El trabajo borrar_transcript_asr nace cuando el worker dueno registra el id,
# ANTES de esperar el transcript. Si lo borrara enseguida, otro worker (un
# redeploy que se solapa) podria borrarlo mientras el dueno todavia lo espera
# o antes de que lo lea. El dueno deja de esperar a los ASR_TIMEOUT_SECONDS
# (mas su ultimo GET y una pausa); el trabajo recien borra en el primer
# intento que, por la politica de la app, no puede llegar antes de eso.
#
# El backoff y el lease los aplica la app (trabajos/politica.ts): el worker
# los lee de contrato/politica-trabajos.json, que un test ata a politica.ts
# (tests/test_contrato_politica_trabajos.py). Entre un intento y el
# siguiente pasa el backoff, o el lease si el worker murio sin resolver: lo
# que sea menor es lo minimo garantizado.
RUTA_POLITICA_TRABAJOS = Path(__file__).resolve().parent / "contrato" / "politica-trabajos.json"


def cargar_politica_borrado_asr(ruta: Path = RUTA_POLITICA_TRABAJOS) -> tuple[tuple[int, ...], int]:
    """(backoff en segundos, lease del worker en segundos). Sin ellos, no arranca."""
    with open(ruta, encoding="utf-8") as f:
        datos = json.load(f).get("borrarTranscriptAsr") or {}
    backoff, lease = datos.get("backoffSeg"), datos.get("leaseWorkerSeg")
    if (not isinstance(backoff, list) or not backoff
            or any(type(x) is not int or x <= 0 for x in backoff)
            or type(lease) is not int or lease <= 0):
        raise ValueError(f"{ruta.name}: borrarTranscriptAsr sin backoffSeg o leaseWorkerSeg validos")
    return tuple(backoff), lease


BACKOFF_BORRADO_ASR_SEG, LEASE_TRABAJO_WORKER_SEG = cargar_politica_borrado_asr()


def espera_minima_antes_del_intento(intento: int) -> int:
    """Segundos que pasaron, como minimo, desde el intento 1 hasta el intento `intento`."""
    total = 0
    for k in range(1, intento):
        backoff = BACKOFF_BORRADO_ASR_SEG[min(k, len(BACKOFF_BORRADO_ASR_SEG)) - 1]
        total += min(backoff, LEASE_TRABAJO_WORKER_SEG)
    return total


def primer_intento_que_borra() -> int:
    """El primer intento en que el worker dueno ya no puede estar esperando el transcript."""
    necesario = config.ASR_TIMEOUT_SECONDS + config.ASR_POLL_SECONDS + asr_assemblyai.TIMEOUT_HTTP_SEG
    intento = 1
    while espera_minima_antes_del_intento(intento) < necesario:
        intento += 1
    return intento


def borrar_transcript_asr(payload: dict, intentos: int | None = None) -> dict:
    """
    DELETE en AssemblyAI. 200 y 404 son "hecho" (idempotente).

    `intentos` es el que entrega la app (cuenta este). Antes de
    primer_intento_que_borra() se devuelve un fallo sin tocar AssemblyAI y la
    app lo reintenta con su backoff: el transcript lo puede estar esperando
    su worker. Si ese worker lo leyo, ya lo borro en su `finally`; este
    trabajo es para cuando murio en el medio.
    """
    transcript_id = payload.get("transcriptId")
    if not transcript_id:
        return _fallo_trabajo("payload sin transcriptId", definitivo=True)
    if not isinstance(intentos, int) or intentos < primer_intento_que_borra():
        return _fallo_trabajo("esperando_al_worker_del_transcript", definitivo=False)
    status = asr_assemblyai._borrar(transcript_id)
    if status in (200, 404):
        return {"ok": True}
    return _fallo_trabajo(f"AssemblyAI respondio HTTP {status}" if status else "AssemblyAI no respondio", definitivo=False)


def generar_feedback(adjunto: dict, uso: Uso | None = None) -> dict:
    """Llamada C con lo que la app adjunta: transcripcion, metricas y orientacion."""
    transcripcion_fmt = adjunto.get("transcripcionFormateada")
    if not isinstance(transcripcion_fmt, str) or not transcripcion_fmt.strip():
        return _fallo_trabajo("adjunto sin transcripcionFormateada", definitivo=True)
    orientacion = adjunto.get("orientacionTeorica")
    if orientacion not in clinical_analyzer._FEEDBACK_POR_ORIENTACION:
        return _fallo_trabajo(clinical_analyzer.ORIENTACION_DESCONOCIDA, definitivo=True)
    speech = adjunto.get("speechAnalytics")
    feedback, prompt_feedback, diag = clinical_analyzer.generar_feedback_terapeuta(
        transcripcion_fmt,
        speech_analytics=speech if isinstance(speech, dict) else None,
        orientacion=orientacion,
        llamadas=uso.llamadas if uso is not None else None,
    )
    if uso is not None and feedback:
        uso.advertencias.extend(diag.advertencias)
    if not feedback:
        motivo = "; ".join(diag.advertencias) or "feedback_no_generado"
        return _fallo_trabajo(motivo, definitivo=diag.definitivo)
    return {
        "ok": True,
        "feedback": feedback,
        "promptVersion": prompt_feedback,
        "modeloLlm": MODELO_LLM,
    }


def _adjunto_invalido(motivo: str) -> PipelineError:
    """Rechazo del adjunto antes de llamar al modelo. `motivo` es texto fijo."""
    return PipelineError("adjunto_invalido", motivo)


def integrar_contexto(adjunto: dict, payload: dict, uso: Uso | None = None) -> dict:
    """La app entrega una base inmutable y la nota aprobada; la IA solo propone."""
    campos = {"tipo", "pacienteId", "sesionId", "version", "contextoVigente", "notaFinal", "datos", "fechaSesion"}
    if (not isinstance(adjunto, dict) or set(adjunto) != campos or not isinstance(payload, dict)
            or adjunto["tipo"] != "integrar_contexto"
            or adjunto["sesionId"] != payload.get("sesionId")
            or adjunto["pacienteId"] != payload.get("pacienteId")
            or type(adjunto["version"]) is not int or adjunto["version"] < 0
            or adjunto["version"] != payload.get("basadaEnVersion")):
        raise _adjunto_invalido("Adjunto de Recorrido inválido")
    contexto = adjunto["contextoVigente"]
    if contexto is not None:
        try:
            validar_recorrido(contexto)
        except ValueError:
            raise _adjunto_invalido("Recorrido vigente que no es un objeto JSON") from None
    if (contexto is None) != (adjunto["version"] == 0):
        raise _adjunto_invalido("Base de Recorrido incompatible")
    nota = adjunto["notaFinal"]
    if not isinstance(nota, dict) or set(nota) != {"subjetivo", "objetivo", "analisis", "plan"} or any(not isinstance(v, str) for v in nota.values()):
        raise _adjunto_invalido("Nota aprobada inválida")
    if not isinstance(adjunto["datos"], dict):
        raise _adjunto_invalido("Datos de sesión inválidos")
    fecha = adjunto["fechaSesion"]
    try:
        if not isinstance(fecha, str) or len(fecha) != 10 or date.fromisoformat(fecha).isoformat() != fecha:
            raise ValueError()
    except ValueError:
        raise _adjunto_invalido("Día de sesión inválido") from None
    datos = {k: v for k, v in adjunto["datos"].items() if k != "riesgoLexico"}
    propuesta, prompt = clinical_analyzer.actualizar_contexto_clinico(
        contexto or {}, nota, datos, adjunto["sesionId"], fecha,
        llamadas=uso.llamadas if uso is not None else None,
    )
    # La forma de la propuesta la fija SCHEMA_CONTEXTO (structured output) y
    # la valida la app al aplicarla: el worker solo exige un objeto JSON.
    return {"ok": True, "propuesta": propuesta, "promptVersion": prompt, "modeloLlm": MODELO_LLM}


def _describir(e: Exception) -> str:
    """
    Lo que viaja como `error` de un trabajo. Un PipelineError trae codigo y
    mensaje publico, escritos para eso. De cualquier otra excepcion, solo el
    tipo: su texto puede traer un valor sacado del contenido (una KeyError con
    una clave, un eco del proveedor).
    """
    if isinstance(e, PipelineError):
        return f"{e.codigo}: {e.mensaje_publico}"
    return type(e).__name__


# Tipo de trabajo -> como se ejecuta. Es la lista de lo que este worker pide
# a la app (TIPOS_TRABAJO); un test la ata a EJECUTOR_DE_TIPO de la app
# (trabajos/crear.ts). Las lambdas buscan la funcion al llamarla: los tests
# la pueden reemplazar en el modulo.
EJECUTORES: dict[str, Callable[[dict, Uso], dict]] = {
    "borrar_transcript_asr": lambda t, _uso: borrar_transcript_asr(t.get("payload") or {}, t.get("intentos")),
    "generar_feedback": lambda t, uso: generar_feedback(t.get("adjunto") or {}, uso),
    "integrar_contexto": lambda t, uso: integrar_contexto(t.get("adjunto"), t.get("payload"), uso),
}

TIPOS_TRABAJO = list(EJECUTORES)

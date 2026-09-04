"""
Orquesta el pipeline completo de una sesion:
R2 -> descifrado -> AssemblyAI -> speech analytics -> nota SOAP -> feedback
-> callback a la app.

La actualizacion del contexto longitudinal (Llamada B) NO vive aca: corre
sobre sesiones ya aprobadas, en contexto_worker.py.

Privacidad de logs: solo ids, conteos, codigos y status. Nunca clave, iv,
texto de transcripcion/nota ni datos del paciente.

procesar_sesion solo encadena pasos con nombre; cada paso traduce sus
fallos a PipelineError con el codigo y mensaje que llegan al callback.
"""
import base64
import logging
from dataclasses import dataclass, field

import app_client
import asr_assemblyai
import clinical_analyzer
import config
import r2_client
import speech_analytics
from clinical_analyzer import mensaje_error_api
from crypto import descifrar
from errores import PipelineError
from transcripcion import formatear_para_llm

logger = logging.getLogger(__name__)


@dataclass
class Modelos:
    """Identificadores que se reportan en el callback (exito o error)."""
    asr: str
    llm: str


@dataclass
class Analisis:
    transcripcion_fmt: str
    nota: dict | None
    datos_estructurados: dict
    prompt_nota: str
    prompt_feedback: str
    # Escalas que llegaron fuera de rango y se anularon, en nota y feedback.
    # La sesion sale igual: solo pierde esos campos.
    advertencias: list[str] = field(default_factory=list)
    # Veces que hubo que pedirle al modelo la nota de nuevo por forma
    # invalida: 0 o 1. Un reintento del feedback queda en `advertencias`,
    # porque el feedback no bloquea la sesion.
    reintentos_llm: int = 0


def procesar_sesion(
    sesion_clinica_id: str,
    audio_r2_key: str,
    clave_cifrado: str,
    iv_cifrado: str,
    paciente_id: str | None = None,
    orientacion_teorica: str = "cbt_mi",
    intento: int = 1,
) -> None:
    etiqueta = sesion_clinica_id
    # ASR provisional (modelo configurado) para los callbacks de error previos
    # a transcribir; tras el ASR se reemplaza por el modelo real usado.
    modelos = Modelos(
        asr=f"assemblyai:{config.ASR_MODEL_ID}",
        llm=f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}",
    )
    try:
        audio = descargar_y_descifrar(etiqueta, audio_r2_key, clave_cifrado, iv_cifrado, intento)
        transcripcion = transcribir(etiqueta, audio)
        del audio
        modelos.asr = f"assemblyai:{transcripcion['speech_model']}"
        analisis = analizar(etiqueta, transcripcion, paciente_id, orientacion_teorica)
        resultado = armar_resultado(transcripcion, analisis, modelos, intento)
        reportar(etiqueta, sesion_clinica_id, resultado)
    except PipelineError as e:
        logger.error(f"[{etiqueta}] {e.codigo}: {e.mensaje_publico}")
        reportar_error(sesion_clinica_id, f"{e.codigo}: {e.mensaje_publico}"[:200], modelos)
    except Exception as e:
        # Sin traza: la cadena de excepciones puede arrastrar cuerpos de
        # respuesta de proveedores. Solo tipo y mensaje acotado.
        logger.error(f"[{etiqueta}] error_interno {type(e).__name__}: {_describir(e)}")
        reportar_error(sesion_clinica_id, "error_interno", modelos)


# Pasos ─────────────────────────────────────────────────────────────────────

def descargar_y_descifrar(
    etiqueta: str, audio_r2_key: str, clave_cifrado: str, iv_cifrado: str, intento: int
) -> bytes:
    """R2 -> bytes de audio en claro, todo en memoria (sin escritura a disco)."""
    if not clave_cifrado or not iv_cifrado:
        raise PipelineError("audio_sin_clave", "Falta clave o iv para descifrar el audio")
    if audio_r2_key == "dev-no-r2":
        raise PipelineError("audio_dev", "Audio en modo dev, no hay audio real")

    logger.info(f"[{etiqueta}] Intento {intento}. Descargando de R2: {audio_r2_key}")
    try:
        audio_cifrado, _ = r2_client.descargar_audio(audio_r2_key)
    except Exception as e:
        logger.error(f"[{etiqueta}] R2 fallo ({type(e).__name__}): {str(e)[:300]}")
        raise PipelineError("r2_error", "No se pudo descargar el audio de R2") from e
    logger.info(f"[{etiqueta}] Descargado: {len(audio_cifrado)} bytes")

    try:
        return descifrar(
            base64.b64encode(audio_cifrado).decode(),
            clave_cifrado,
            iv_cifrado,
        )
    except ValueError as e:
        # Los mensajes de crypto.descifrar son de forma (largos, tag), sin material de clave.
        logger.error(f"[{etiqueta}] Descifrado fallo: {str(e)[:120]}")
        raise PipelineError("descifrado_error", "No se pudo descifrar el audio") from e


def transcribir(etiqueta: str, audio_bytes: bytes) -> dict:
    """AssemblyAI: transcripcion diarizada normalizada (ver asr_assemblyai)."""
    logger.info(f"[{etiqueta}] Transcribiendo ({len(audio_bytes)} bytes)...")
    transcripcion = asr_assemblyai.transcribir(audio_bytes)
    segments = transcripcion.get("segments") or []
    if not segments:
        raise PipelineError("asr_vacio", "La transcripcion no contiene segmentos")
    logger.info(
        f"[{etiqueta}] {len(segments)} segmentos, "
        f"{transcripcion['duration_seconds']}s, roles={transcripcion['roles_origen']}, "
        f"modelo=assemblyai:{transcripcion['speech_model']}"
    )
    return transcripcion


def analizar(
    etiqueta: str,
    transcripcion: dict,
    paciente_id: str | None,
    orientacion_teorica: str,
) -> Analisis:
    """Speech analytics + contexto longitudinal + nota SOAP (A) + feedback (C)."""
    transcripcion_fmt = formatear_para_llm(transcripcion)

    speech_metrics = speech_analytics.compute(transcripcion["segments"])
    speech_metrics["rolesOrigen"] = transcripcion["roles_origen"]

    # Golden Thread: best-effort, None si no hay o falla.
    contexto_llm = (
        app_client.obtener_contexto_clinico_llm(paciente_id) if paciente_id else None
    )
    if contexto_llm:
        logger.info(f"[{etiqueta}] Contexto longitudinal: {len(contexto_llm)} chars")

    logger.info(f"[{etiqueta}] Generando nota...")
    resultado, prompt_nota, diag_nota = clinical_analyzer.analizar(
        transcripcion_fmt,
        contexto_clinico=contexto_llm,
        speech_analytics=speech_metrics,
    )
    datos_estructurados = resultado.get("datosEstructurados") or {}
    datos_estructurados["speechAnalytics"] = speech_metrics

    logger.info(f"[{etiqueta}] Generando feedback terapeuta...")
    feedback, prompt_feedback, diag_feedback = clinical_analyzer.generar_feedback_terapeuta(
        transcripcion_fmt,
        speech_analytics=speech_metrics,
        orientacion=orientacion_teorica,
    )
    if feedback:
        datos_estructurados["feedbackTerapeuta"] = feedback

    advertencias = [*diag_nota.advertencias, *diag_feedback.advertencias]
    if diag_feedback.reintentos:
        advertencias.append("feedbackTerapeuta requirio una segunda pasada")
    if advertencias:
        logger.info(f"[{etiqueta}] {len(advertencias)} advertencia(s) de forma")

    return Analisis(
        transcripcion_fmt=transcripcion_fmt,
        nota=resultado.get("nota"),
        datos_estructurados=datos_estructurados,
        prompt_nota=prompt_nota,
        prompt_feedback=prompt_feedback,
        advertencias=advertencias,
        reintentos_llm=diag_nota.reintentos,
    )


def armar_resultado(
    transcripcion: dict, analisis: Analisis, modelos: Modelos, intento: int
) -> dict:
    """Argumentos del callback de exito (nombres = parametros de enviar_callback)."""
    datos = analisis.datos_estructurados
    datos["_pipeline"] = {
        "promptNota": analisis.prompt_nota,
        "promptFeedback": analisis.prompt_feedback,
        "modeloLLM": modelos.llm,
        "modeloASR": modelos.asr,
        "rolesOrigen": transcripcion["roles_origen"],
        "workerVersion": config.WORKER_VERSION,
        "asrId": transcripcion.get("asr_id"),
        "intento": intento,
        # Escalas anuladas por venir fuera de rango. Lista vacia = la salida
        # del modelo vino limpia.
        "advertencias": analisis.advertencias,
        # 0 o 1: si hizo falta pedirle la nota de nuevo por forma invalida.
        "reintentosLLM": analisis.reintentos_llm,
    }
    # audio_duration: transcripcion["duration_seconds"] queda disponible pero
    # NO se envia; el contrato del callback (callbackSchema en
    # src/app/api/sesion-clinica/callback/route.ts) todavia no lo acepta.
    # Cuando exista el campo, va aca como `duracionAudioSeg`.
    return {
        "transcripcion": analisis.transcripcion_fmt,
        "nota": analisis.nota,
        "datos_estructurados": datos,
        "modelo_asr": modelos.asr,
        "modelo_llm": modelos.llm,
        "prompt_version": f"{analisis.prompt_nota}+{analisis.prompt_feedback}",
    }


def reportar(etiqueta: str, sesion_clinica_id: str, resultado: dict) -> None:
    """Callback de exito. El audio NO se borra aca: vive en R2 hasta /aprobar."""
    res = app_client.enviar_callback(
        sesion_clinica_id=sesion_clinica_id, estado="revision", **resultado
    )
    if not res.terminal:
        logger.error(f"[{etiqueta}] Callback fallo (status={res.status}); el lease reintentara")
        return
    logger.info(f"[{etiqueta}] Completado")


def reportar_error(sesion_clinica_id: str, error: str, modelos: Modelos) -> None:
    """Callback de error, best-effort: si tambien falla solo se loguea."""
    try:
        app_client.enviar_callback(
            sesion_clinica_id=sesion_clinica_id,
            estado="error",
            error=error,
            modelo_asr=modelos.asr,
            modelo_llm=modelos.llm,
        )
    except Exception as e:
        logger.error(f"[{sesion_clinica_id}] Callback de error tambien fallo ({type(e).__name__})")


def _describir(e: Exception) -> str:
    """Mensaje acotado: el de la API de Anthropic si lo hay, si no str(e) truncado."""
    return mensaje_error_api(e) or str(e)[:200]

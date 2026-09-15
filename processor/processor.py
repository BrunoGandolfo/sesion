"""
Orquesta el pipeline de una sesion reclamada:
R2 (segmentos) -> descifrado -> AssemblyAI -> checkpoint de transcripcion en
la app -> nota SOAP -> resultado a la app. Y ejecuta los trabajos durables
que la app le entrega (borrar el transcript en AssemblyAI, generar "Para vos").

Reglas con la app (contrato Area 2, src/app/api/_lib/casos-uso/sesion/*):
  - todo lo que se escribe sobre la sesion lleva el ticket del reclamo y el
    numero de intento; un 401/409 significa que otro reclamo se llevo la
    sesion y se abandona la corrida sin informar nada (LeasePerdido);
  - el lease se renueva cada LEASE_RENOVACION_SEG en un hilo aparte mientras
    dura la corrida;
  - la transcripcion se registra apenas existe (checkpoint), antes de la
    primera llamada al modelo: si la sesion vuelve, llega con `checkpoint` y
    no se descarga audio ni se paga el ASR de nuevo;
  - el transcript de AssemblyAI se registra apenas se conoce su id, para que
    la app lo borre con reintentos aunque este proceso muera;
  - "Para vos" NO se genera aca: la app crea el trabajo `generar_feedback` al
    recibir la nota y llega por /api/trabajos/pendientes con la transcripcion
    adjunta.

Privacidad de logs: solo ids, conteos, codigos y status. Nunca clave, iv,
texto de transcripcion/nota ni datos del paciente.
"""
from pathlib import Path
import logging
import threading
from dataclasses import dataclass, field

import requests

import app_client
import asr_assemblyai
import clinical_analyzer
import config
from audio_entrada import armar_audio
import speech_analytics
from clinical_analyzer import mensaje_error_api
from errores import LeasePerdido, PipelineError
from transcripcion import formatear_para_llm

logger = logging.getLogger(__name__)

# Cada cuanto se renueva el lease. La app lo da por 5 min (LEASE_SESION_MS):
# un worker muerto se detecta en ese plazo.
LEASE_RENOVACION_SEG = 60

# Tipos de trabajo que este worker sabe ejecutar. integrar_contexto lo suma
# el Area 4 cuando enganche la Llamada B.
TIPOS_TRABAJO = ["borrar_transcript_asr", "generar_feedback"]

TIMEOUT_ASR_DELETE_SEG = 30


# Sesion reclamada ──────────────────────────────────────────────────────────

@dataclass
class SesionReclamada:
    """Un item de GET /api/sesion-clinica/pendientes (SesionReclamada en reclamar.ts)."""
    sesion_clinica_id: str
    intento: int
    ticket: str
    paciente_id: str | None
    orientacion_teorica: str
    terminos_asr: list[str]
    # {clave: base64, segmentos: [{indice, key, iv: base64, bytes}]} o None si hay checkpoint.
    audio: dict | None
    # {transcripcion, speechAnalytics, modeloAsr} o None.
    checkpoint: dict | None
    duracion_audio_seg: int | None = None

    @staticmethod
    def desde_item(item: dict) -> "SesionReclamada | None":
        """None si faltan los campos sin los cuales no se puede ni empezar."""
        if not isinstance(item, dict):
            return None
        sesion_id = item.get("sesionClinicaId")
        ticket = item.get("ticket")
        intento = item.get("intento")
        if not sesion_id or not ticket or not isinstance(intento, int) or intento < 1:
            return None
        audio = item.get("audio") if isinstance(item.get("audio"), dict) else None
        checkpoint = item.get("checkpoint") if isinstance(item.get("checkpoint"), dict) else None
        if checkpoint and not checkpoint.get("transcripcion"):
            checkpoint = None
        if not audio and not checkpoint:
            return None
        return SesionReclamada(
            sesion_clinica_id=sesion_id,
            intento=intento,
            ticket=ticket,
            paciente_id=item.get("pacienteId") or None,
            orientacion_teorica=item.get("orientacionTeorica") or "cbt_mi",
            terminos_asr=terminos_asr_de(item),
            audio=audio,
            checkpoint=checkpoint,
            duracion_audio_seg=item.get("duracionAudioSeg"),
        )


def terminos_asr_de(sesion: dict) -> list[str]:
    """`terminosAsr` saneado: solo strings con contenido; cualquier otra cosa, lista vacia."""
    valor = sesion.get("terminosAsr")
    if not isinstance(valor, list):
        return []
    return [t for t in valor if isinstance(t, str) and t.strip()]


# Lease ─────────────────────────────────────────────────────────────────────

class Lease:
    """
    Renueva el lease de la sesion cada LEASE_RENOVACION_SEG en un hilo
    daemon. Si la app rechaza (401/409), marca `perdido`: el pipeline lo
    consulta entre pasos y abandona. Un 5xx o un corte de red no lo pierde:
    la proxima renovacion lo intenta de nuevo.
    """

    def __init__(self, sesion: SesionReclamada, intervalo_seg: float = LEASE_RENOVACION_SEG):
        self.sesion = sesion
        self.intervalo_seg = intervalo_seg
        self.perdido = False
        self.paso = "inicio"
        self._parar = threading.Event()
        self._hilo = threading.Thread(target=self._correr, name=f"lease-{sesion.sesion_clinica_id}", daemon=True)

    def __enter__(self) -> "Lease":
        self._hilo.start()
        return self

    def __exit__(self, *_exc) -> None:
        self._parar.set()
        self._hilo.join(timeout=5)

    def _correr(self) -> None:
        while not self._parar.wait(self.intervalo_seg):
            self.renovar()

    def renovar(self) -> None:
        try:
            res = app_client.renovar_lease(
                self.sesion.sesion_clinica_id, self.sesion.ticket, self.sesion.intento, self.paso
            )
        except Exception as e:  # el hilo no puede morir por una excepcion
            logger.warning(f"[{self.sesion.sesion_clinica_id}] lease: {type(e).__name__}")
            return
        if res.rechazado:
            self.perdido = True

    def comprobar(self, paso: str) -> None:
        self.paso = paso
        if self.perdido:
            raise LeasePerdido()


# Pipeline ──────────────────────────────────────────────────────────────────

@dataclass
class Transcripto:
    """Lo que hace falta del ASR para el modelo, venga del checkpoint o de AssemblyAI."""
    transcripcion_fmt: str
    speech_metrics: dict
    modelo_asr: str


@dataclass
class Analisis:
    nota: dict
    datos_estructurados: dict
    prompt_nota: str
    # Escalas que llegaron fuera de rango y se anularon. La sesion sale igual.
    advertencias: list[str] = field(default_factory=list)
    # Veces que hubo que pedirle al modelo la nota de nuevo por forma invalida.
    reintentos_llm: int = 0


def procesar_sesion(sesion: SesionReclamada) -> None:
    etiqueta = sesion.sesion_clinica_id
    modelo_llm = f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}"
    with Lease(sesion) as lease:
        try:
            if sesion.checkpoint:
                logger.info(f"[{etiqueta}] Intento {sesion.intento}: con checkpoint, no se transcribe de nuevo")
                transcripto = desde_checkpoint(sesion.checkpoint)
            else:
                lease.comprobar("audio")
                with armar_audio(etiqueta, sesion.audio) as audio:
                    if audio.huecos:
                        logger.warning(f"[{etiqueta}] Audio posiblemente incompleto: {len(audio.huecos)} hueco(s); sin relleno")
                        pausas = list(sesion.audio.get("pausas") or [])
                        pausas.extend(h for h in audio.huecos if h not in pausas)
                        recibo = app_client.renovar_lease(etiqueta, sesion.ticket, sesion.intento, "audio", pausas_audio=pausas)
                        if recibo.rechazado:
                            raise LeasePerdido()
                        if not recibo.ok:
                            raise PipelineError("app_error", "No se pudo guardar el aviso de audio incompleto", definitivo=False)
                    lease.comprobar("asr")
                    transcripcion = transcribir(etiqueta, audio.archivo, sesion.terminos_asr)
                transcripto = registrar_checkpoint(sesion, transcripcion)
            lease.comprobar("nota")
            analisis = analizar(etiqueta, transcripto, sesion.paciente_id)
            lease.comprobar("resultado")
            reportar_nota(sesion, analisis, modelo_llm)
        except LeasePerdido:
            logger.warning(f"[{etiqueta}] el intento {sesion.intento} ya no es el vigente; se abandona sin informar")
        except PipelineError as e:
            logger.error(f"[{etiqueta}] {e.codigo}: {e.mensaje_publico} ({'definitivo' if e.definitivo else 'transitorio'})")
            reportar_fallo(sesion, e, lease.paso)
        except Exception as e:
            # Sin traza: la cadena de excepciones puede arrastrar cuerpos de
            # respuesta de proveedores. Solo tipo y mensaje acotado.
            logger.error(f"[{etiqueta}] error_interno {type(e).__name__}: {_describir(e)}")
            reportar_fallo(sesion, PipelineError("error_interno", "Error interno del worker", definitivo=False), lease.paso)


# Pasos ─────────────────────────────────────────────────────────────────────

def transcribir(etiqueta: str, archivo: Path, terminos_asr: list[str] | None = None) -> dict:
    """AssemblyAI: transcripcion diarizada normalizada (ver asr_assemblyai)."""
    terminos = terminos_asr or []
    logger.info(
        f"[{etiqueta}] Transcribiendo ({archivo.stat().st_size} bytes, "
        # Solo la cantidad: los terminos pueden ser nombres propios de la paciente.
        f"{len(terminos)} terminos ASR)..."
    )
    with archivo.open("rb") as audio:
        transcripcion = asr_assemblyai.transcribir(audio, terminos)
    segments = transcripcion.get("segments") or []
    if not segments:
        raise PipelineError("asr_vacio", "La transcripcion no contiene segmentos")
    logger.info(
        f"[{etiqueta}] {len(segments)} segmentos, "
        f"{transcripcion['duration_seconds']}s, roles={transcripcion['roles_origen']}, "
        f"modelo=assemblyai:{transcripcion['speech_model']}"
    )
    return transcripcion


def registrar_checkpoint(sesion: SesionReclamada, transcripcion: dict) -> Transcripto:
    """
    Registra el transcript en AssemblyAI (para que la app lo borre con
    reintentos) y guarda la transcripcion formateada como checkpoint. Los dos
    van con ticket e intento: un rechazo es LeasePerdido; un 5xx es un fallo
    transitorio (la sesion vuelve y se transcribe de nuevo, porque el
    checkpoint no quedo).
    """
    etiqueta = sesion.sesion_clinica_id
    asr_id = transcripcion.get("asr_id")
    if asr_id:
        res = app_client.registrar_asr(etiqueta, sesion.ticket, sesion.intento, asr_id)
        if res.rechazado:
            raise LeasePerdido()
        if not res.ok:
            # Best-effort: el transcript ya se borra en asr_assemblyai al
            # terminar; la app solo pierde el reintento durable.
            logger.warning(f"[{etiqueta}] no se pudo registrar el transcript (status={res.status})")

    speech_metrics = speech_analytics.compute(transcripcion["segments"])
    speech_metrics["rolesOrigen"] = transcripcion["roles_origen"]
    transcripcion_fmt = formatear_para_llm(transcripcion)
    modelo_asr = f"assemblyai:{transcripcion['speech_model']}"

    res = app_client.registrar_transcripcion(
        etiqueta,
        sesion.ticket,
        sesion.intento,
        transcripcion_fmt,
        modelo_asr,
        speech_analytics=speech_metrics,
        duracion_seg=transcripcion.get("duration_seconds"),
        asr_transcript_id=asr_id,
    )
    if res.rechazado:
        raise LeasePerdido()
    if not res.ok:
        raise PipelineError("app_error", f"La app no guardo la transcripcion (HTTP {res.status})", definitivo=False)
    return Transcripto(transcripcion_fmt=transcripcion_fmt, speech_metrics=speech_metrics, modelo_asr=modelo_asr)


def desde_checkpoint(checkpoint: dict) -> Transcripto:
    transcripcion_fmt = checkpoint.get("transcripcion")
    if not isinstance(transcripcion_fmt, str) or not transcripcion_fmt.strip():
        raise PipelineError("checkpoint_invalido", "El checkpoint no trae transcripcion")
    speech = checkpoint.get("speechAnalytics")
    return Transcripto(
        transcripcion_fmt=transcripcion_fmt,
        speech_metrics=speech if isinstance(speech, dict) else {},
        modelo_asr=str(checkpoint.get("modeloAsr") or f"assemblyai:{config.ASR_MODEL_ID}"),
    )


def analizar(etiqueta: str, transcripto: Transcripto, paciente_id: str | None) -> Analisis:
    """Contexto longitudinal (best-effort) + nota SOAP (Llamada A). Sin feedback: es otro trabajo."""
    contexto_llm = app_client.obtener_contexto_clinico_llm(paciente_id) if paciente_id else None
    if contexto_llm:
        logger.info(f"[{etiqueta}] Contexto longitudinal: {len(contexto_llm)} chars")

    logger.info(f"[{etiqueta}] Generando nota...")
    resultado, prompt_nota, diag = clinical_analyzer.analizar(
        transcripto.transcripcion_fmt,
        contexto_clinico=contexto_llm,
        speech_analytics=transcripto.speech_metrics,
    )
    nota = resultado.get("nota")
    if not isinstance(nota, dict):
        raise PipelineError("llm_invalido", "El modelo no devolvio una nota")
    datos = resultado.get("datosEstructurados") or {}
    datos["speechAnalytics"] = transcripto.speech_metrics
    if diag.advertencias:
        logger.info(f"[{etiqueta}] {len(diag.advertencias)} advertencia(s) de forma")
    return Analisis(
        nota=nota,
        datos_estructurados=datos,
        prompt_nota=prompt_nota,
        advertencias=list(diag.advertencias),
        reintentos_llm=diag.reintentos,
    )


def reportar_nota(sesion: SesionReclamada, analisis: Analisis, modelo_llm: str) -> None:
    """Resultado "nota". Si la app rechaza, otro intento ya es el vigente."""
    payload = {
        "intento": sesion.intento,
        "resultado": "nota",
        "nota": analisis.nota,
        "datos": analisis.datos_estructurados,
        "modeloLlm": modelo_llm,
        "promptVersion": analisis.prompt_nota,
    }
    res = app_client.enviar_resultado(sesion.sesion_clinica_id, sesion.ticket, payload)
    if res.rechazado:
        raise LeasePerdido()
    if not res.terminal:
        logger.error(f"[{sesion.sesion_clinica_id}] Resultado fallo (status={res.status}); el lease reintentara")
        return
    logger.info(f"[{sesion.sesion_clinica_id}] Completado")


def reportar_fallo(sesion: SesionReclamada, error: PipelineError, paso: str) -> None:
    """Resultado "fallo", best-effort: si tambien falla solo se loguea."""
    payload = {
        "intento": sesion.intento,
        "resultado": "fallo",
        "codigo": error.codigo[:60],
        "definitivo": error.definitivo,
        "paso": paso[:40],
        "detalle": error.mensaje_publico[:500],
    }
    try:
        app_client.enviar_resultado(sesion.sesion_clinica_id, sesion.ticket, payload)
    except Exception as e:
        logger.error(f"[{sesion.sesion_clinica_id}] El resultado de fallo tambien fallo ({type(e).__name__})")


# Trabajos durables ─────────────────────────────────────────────────────────

def ejecutar_trabajo(trabajo: dict) -> dict:
    """
    Ejecuta un trabajo entregado por GET /api/trabajos/pendientes y devuelve
    el payload para POST /api/trabajos/[id]/resultado ({ok: true, ...} o
    {ok: false, error}). Nunca lanza.
    """
    tipo = trabajo.get("tipo")
    try:
        if tipo == "borrar_transcript_asr":
            return borrar_transcript_asr(trabajo.get("payload") or {})
        if tipo == "generar_feedback":
            return generar_feedback(trabajo.get("adjunto") or {})
        return {"ok": False, "error": f"tipo no soportado: {tipo}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {_describir(e)}"[:500]}


def borrar_transcript_asr(payload: dict) -> dict:
    """DELETE en AssemblyAI. 200 y 404 son "hecho" (idempotente)."""
    transcript_id = payload.get("transcriptId")
    if not transcript_id:
        return {"ok": False, "error": "payload sin transcriptId"}
    response = requests.delete(
        f"{asr_assemblyai.API_BASE}/transcript/{transcript_id}",
        headers={"authorization": config.ASSEMBLYAI_API_KEY},
        timeout=TIMEOUT_ASR_DELETE_SEG,
    )
    logger.info(f"AssemblyAI delete {transcript_id}: HTTP {response.status_code}")
    if response.status_code in (200, 404):
        return {"ok": True}
    return {"ok": False, "error": f"AssemblyAI respondio HTTP {response.status_code}"}


def generar_feedback(adjunto: dict) -> dict:
    """Llamada C con lo que la app adjunta: transcripcion, metricas y orientacion."""
    transcripcion_fmt = adjunto.get("transcripcionFormateada")
    if not isinstance(transcripcion_fmt, str) or not transcripcion_fmt.strip():
        return {"ok": False, "error": "adjunto sin transcripcionFormateada"}
    speech = adjunto.get("speechAnalytics")
    feedback, prompt_feedback, diag = clinical_analyzer.generar_feedback_terapeuta(
        transcripcion_fmt,
        speech_analytics=speech if isinstance(speech, dict) else None,
        orientacion=adjunto.get("orientacionTeorica") or "cbt_mi",
    )
    if not feedback:
        motivo = "; ".join(diag.advertencias) or "feedback_no_generado"
        return {"ok": False, "error": motivo[:500]}
    return {
        "ok": True,
        "feedback": feedback,
        "promptVersion": prompt_feedback,
        "modeloLlm": f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}",
    }


def _describir(e: Exception) -> str:
    """Mensaje acotado: el de la API de Anthropic si lo hay, si no str(e) truncado."""
    return mensaje_error_api(e) or str(e)[:200]

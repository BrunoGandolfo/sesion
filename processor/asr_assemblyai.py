"""
Cliente REST de AssemblyAI (sin SDK): upload -> transcript -> polling -> delete.

Contrato de salida de transcribir():
    {
      "duration_seconds": int,
      "segments": [{"speaker": "S0"|"S1", "start": float, "end": float, "text": str}],
      "roles_origen": "asr_role" | "posicional",
      "asr_id": str,
    }
S0 = Terapeuta, S1 = Paciente (mismo mapeo que consume speech_analytics y
transcripcion.formatear_para_llm).

Privacidad: nunca se loguea ni se propaga el body de las respuestas de
AssemblyAI (contiene la transcripcion). De su campo `error` se loguean a lo
sumo los primeros 80 caracteres (es un codigo tecnico).
"""
import logging
import time

import requests

import config
from errores import PipelineError

logger = logging.getLogger(__name__)

# Endpoints (docs vigentes):
#   POST   /v2/upload            https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/files/upload
#   POST   /v2/transcript        https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit
#   GET    /v2/transcript/{id}   https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/get
#   DELETE /v2/transcript/{id}   https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/delete
# Autenticacion: header `authorization: <api key>` (la key cruda, sin "Bearer").
API_BASE = "https://api.assemblyai.com/v2"

ROL_TERAPEUTA = "Terapeuta"
ROL_PACIENTE = "Paciente"

# Identificacion de hablantes por rol (Speech Understanding). Anidamiento,
# requisito de speaker_labels=true y forma de la respuesta segun:
#   https://www.assemblyai.com/docs/speech-understanding/speaker-identification
# Request: speech_understanding.request.speaker_identification
#          {speaker_type: "role", speakers: [{role, description}]}
# Respuesta: utterances[].speaker pasa a ser el rol, y ademas
#          speech_understanding.response.speaker_identification.mapping
#          ({"A": "Terapeuta", ...}) con `status`. Soporta espanol (es).
SPEAKER_IDENTIFICATION = {
    "speaker_type": "role",
    "speakers": [
        {
            "role": ROL_TERAPEUTA,
            "description": (
                "profesional que conduce la sesión de psicoterapia: saluda, "
                "encuadra, pregunta, señala"
            ),
        },
        {
            "role": ROL_PACIENTE,
            "description": "persona consultante que relata su vivencia y responde",
        },
    ],
}

# Opciones de diarizacion. Una sesion de psicoterapia es diadica; fijar
# min=max=2 acota la separacion. `speaker_options` (no combinable con
# `speakers_expected`) segun:
#   https://www.assemblyai.com/docs/pre-recorded-audio/label-speakers
SPEAKER_OPTIONS = {"min_speakers_expected": 2, "max_speakers_expected": 2}

TIMEOUT_UPLOAD_SEG = 600  # audios de 60-90 min pueden pesar decenas de MB
TIMEOUT_HTTP_SEG = 30
MAX_FALLOS_POLLING_CONSECUTIVOS = 5


def _headers(extra: dict | None = None) -> dict:
    h = {"authorization": config.ASSEMBLYAI_API_KEY}
    if extra:
        h.update(extra)
    return h


def _codigo_error(response: requests.Response) -> str:
    """Primeros 80 chars del campo `error` de AssemblyAI; nunca el body entero."""
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    err = body.get("error")
    return str(err)[:80] if err else ""


def _fallo_http(response: requests.Response, etapa: str) -> PipelineError:
    codigo = _codigo_error(response)
    logger.error(
        f"AssemblyAI {etapa}: HTTP {response.status_code}"
        + (f" error={codigo}" if codigo else "")
    )
    return PipelineError("asr_error", f"AssemblyAI respondio {response.status_code} en {etapa}")


def _fallo_red(e: Exception, etapa: str) -> PipelineError:
    logger.error(f"AssemblyAI {etapa}: sin respuesta ({type(e).__name__})")
    return PipelineError("asr_error", f"AssemblyAI no responde en {etapa}")


# Etapas ────────────────────────────────────────────────────────────────────

def _subir(audio_bytes: bytes) -> str:
    # Cuerpo binario crudo (no multipart) con content-type
    # application/octet-stream; responde {"upload_url": ...}:
    #   https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/files/upload
    try:
        response = requests.post(
            f"{API_BASE}/upload",
            headers=_headers({"content-type": "application/octet-stream"}),
            data=audio_bytes,
            timeout=TIMEOUT_UPLOAD_SEG,
        )
    except requests.RequestException as e:
        raise _fallo_red(e, "upload") from e
    if not response.ok:
        raise _fallo_http(response, "upload")
    upload_url = (response.json() or {}).get("upload_url")
    if not upload_url:
        raise PipelineError("asr_error", "AssemblyAI no devolvio upload_url")
    return upload_url


def _modelos() -> list[str]:
    """Lista ordenada principal + fallback, sin vacios ni duplicados."""
    modelos: list[str] = []
    for m in (config.ASR_MODEL_ID, config.ASR_MODEL_FALLBACK):
        m = (m or "").strip()
        if m and m not in modelos:
            modelos.append(m)
    return modelos


def _crear_transcript(upload_url: str) -> str:
    # Parametros segun
    #   https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit
    # - speech_models: lista en orden de prioridad (reemplaza a `speech_model`,
    #   deprecado); si el modelo principal no soporta el idioma cae al siguiente.
    #   https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model
    # - language_code "es": valor valido del enum TranscriptLanguageCode.
    # - prompt: contexto en lenguaje natural, solo Universal-3.5 Pro.
    #   https://www.assemblyai.com/docs/pre-recorded-audio/universal-3-5-pro/prompting
    payload: dict = {
        "audio_url": upload_url,
        "speech_models": _modelos(),
        "language_code": "es",
        "speaker_labels": True,
        "speaker_options": SPEAKER_OPTIONS,
        "speech_understanding": {
            "request": {"speaker_identification": SPEAKER_IDENTIFICATION},
        },
    }
    prompt = (config.ASR_PROMPT_ESCENARIO or "").strip()
    if prompt:
        payload["prompt"] = prompt
    try:
        response = requests.post(
            f"{API_BASE}/transcript",
            headers=_headers(),
            json=payload,
            timeout=TIMEOUT_HTTP_SEG,
        )
    except requests.RequestException as e:
        raise _fallo_red(e, "transcript") from e
    if not response.ok:
        raise _fallo_http(response, "transcript")
    transcript_id = (response.json() or {}).get("id")
    if not transcript_id:
        raise PipelineError("asr_error", "AssemblyAI no devolvio id de transcript")
    return str(transcript_id)


def _esperar(transcript_id: str) -> dict:
    """
    Polling hasta status completed/error o hasta ASR_TIMEOUT_SECONDS.
    status ∈ {queued, processing, completed, error}:
      https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/get
    """
    url = f"{API_BASE}/transcript/{transcript_id}"
    deadline = time.monotonic() + config.ASR_TIMEOUT_SECONDS
    fallos_consecutivos = 0

    while time.monotonic() < deadline:
        try:
            response = requests.get(url, headers=_headers(), timeout=TIMEOUT_HTTP_SEG)
        except requests.RequestException as e:
            fallos_consecutivos += 1
            logger.warning(
                f"AssemblyAI polling {transcript_id}: sin respuesta "
                f"({type(e).__name__}), fallo {fallos_consecutivos}"
            )
            if fallos_consecutivos >= MAX_FALLOS_POLLING_CONSECUTIVOS:
                raise _fallo_red(e, "polling") from e
            time.sleep(config.ASR_POLL_SECONDS)
            continue

        if response.status_code >= 500:
            fallos_consecutivos += 1
            logger.warning(
                f"AssemblyAI polling {transcript_id}: HTTP {response.status_code}, "
                f"fallo {fallos_consecutivos}"
            )
            if fallos_consecutivos >= MAX_FALLOS_POLLING_CONSECUTIVOS:
                raise _fallo_http(response, "polling")
            time.sleep(config.ASR_POLL_SECONDS)
            continue

        if not response.ok:
            raise _fallo_http(response, "polling")

        fallos_consecutivos = 0
        data = response.json() or {}
        status = data.get("status")
        if status == "completed":
            return data
        if status == "error":
            codigo = _codigo_error(response)
            logger.error(
                f"AssemblyAI {transcript_id}: status=error"
                + (f" error={codigo}" if codigo else "")
            )
            raise PipelineError("asr_error", "AssemblyAI devolvio status error")

        time.sleep(config.ASR_POLL_SECONDS)

    logger.error(f"AssemblyAI {transcript_id}: timeout tras {config.ASR_TIMEOUT_SECONDS}s")
    raise PipelineError(
        "asr_timeout", f"AssemblyAI no completo en {config.ASR_TIMEOUT_SECONDS}s"
    )


def _borrar(transcript_id: str) -> None:
    """
    DELETE best-effort: solo se loguea el status, nunca falla.
    Borra el transcript y el archivo subido via /upload:
      https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/delete
    """
    try:
        response = requests.delete(
            f"{API_BASE}/transcript/{transcript_id}",
            headers=_headers(),
            timeout=TIMEOUT_HTTP_SEG,
        )
        logger.info(f"AssemblyAI delete {transcript_id}: HTTP {response.status_code}")
    except Exception as e:
        logger.warning(f"AssemblyAI delete {transcript_id}: fallo ({type(e).__name__})")


# Normalizacion ─────────────────────────────────────────────────────────────

def _mapping_roles(data: dict) -> dict[str, str]:
    """
    speech_understanding.response.speaker_identification.mapping
    ({"A": "Terapeuta", "B": "Paciente"}) si vino; {} en cualquier otro caso.
    Docs: https://www.assemblyai.com/docs/speech-understanding/speaker-identification
    """
    su = data.get("speech_understanding")
    if not isinstance(su, dict):
        return {}
    resp = su.get("response")
    if not isinstance(resp, dict):
        return {}
    ident = resp.get("speaker_identification")
    if not isinstance(ident, dict):
        return {}
    mapping = ident.get("mapping")
    if not isinstance(mapping, dict):
        return {}
    return {str(k): str(v) for k, v in mapping.items() if v is not None}


def _normalizar(data: dict, transcript_id: str) -> dict:
    utterances = data.get("utterances") or []
    if not isinstance(utterances, list):
        utterances = []

    # Con identificacion por rol, utterances[].speaker ya trae el rol; el
    # `mapping` cubre el caso en que vengan las letras (A/B) y el rol aparte.
    mapping = _mapping_roles(data)
    etiquetas = [
        mapping.get(str(u.get("speaker")), str(u.get("speaker")))
        for u in utterances
        if isinstance(u, dict) and u.get("speaker") is not None
    ]
    con_rol = any(e in (ROL_TERAPEUTA, ROL_PACIENTE) for e in etiquetas)

    if con_rol:
        roles_origen = "asr_role"

        def a_speaker(etiqueta: str) -> str:
            return "S0" if etiqueta == ROL_TERAPEUTA else "S1"
    else:
        # Etiquetas genericas (A/B/...): la primera que aparece se asume
        # terapeuta (abre la sesion), el resto paciente.
        roles_origen = "posicional"
        primera = etiquetas[0] if etiquetas else None

        def a_speaker(etiqueta: str) -> str:
            return "S0" if etiqueta == primera else "S1"

    segments: list[dict] = []
    descartados = 0
    for u in utterances:
        if not isinstance(u, dict):
            descartados += 1
            continue
        speaker = u.get("speaker")
        start_ms = u.get("start")
        end_ms = u.get("end")
        if speaker is None or start_ms is None or end_ms is None:
            descartados += 1
            continue
        try:
            start = float(start_ms) / 1000.0
            end = float(end_ms) / 1000.0
        except (TypeError, ValueError):
            descartados += 1
            continue
        etiqueta = mapping.get(str(speaker), str(speaker))
        segments.append({
            "speaker": a_speaker(etiqueta),
            "start": start,
            "end": end,
            "text": str(u.get("text") or ""),
        })

    # audio_duration: entero en segundos (GET /v2/transcript/{id}).
    duracion_reportada = data.get("audio_duration")
    if isinstance(duracion_reportada, (int, float)) and duracion_reportada > 0:
        duracion = float(duracion_reportada)
    else:
        duracion = max((s["end"] for s in segments), default=0.0)

    # speech_model_used: cual de los speech_models proceso el audio.
    modelo_usado = data.get("speech_model_used")
    logger.info(
        f"AssemblyAI {transcript_id}: {len(utterances)} utterances, "
        f"{len(segments)} validas, {descartados} descartadas, "
        f"{duracion:.0f}s, hablantes={len(set(etiquetas))}, roles={roles_origen}"
        + (f", modelo={modelo_usado}" if modelo_usado else "")
    )
    return {
        "duration_seconds": int(duracion),
        "segments": segments,
        "roles_origen": roles_origen,
        "asr_id": transcript_id,
    }


# API publica ───────────────────────────────────────────────────────────────

def transcribir(audio_bytes: bytes, content_type: str = "audio/webm") -> dict:
    """
    Transcribe y diariza el audio (bytes ya descifrados) via AssemblyAI.
    `content_type` se acepta por contrato; el endpoint de upload recibe el
    audio como application/octet-stream y detecta el formato solo.
    """
    logger.info(f"AssemblyAI: subiendo {len(audio_bytes)} bytes ({content_type})")
    upload_url = _subir(audio_bytes)
    transcript_id = _crear_transcript(upload_url)
    logger.info(f"AssemblyAI: transcript {transcript_id} creado, esperando...")
    try:
        data = _esperar(transcript_id)
        return _normalizar(data, transcript_id)
    finally:
        _borrar(transcript_id)

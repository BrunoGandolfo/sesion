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

API_BASE = "https://api.assemblyai.com/v2"

# Identificacion de hablantes por rol. Verificar contra docs.assemblyai.com al
# primer deploy: tanto el nombre del parametro como la forma del objeto
# (speaker_type / speakers[{role, description}]) no pudieron verificarse
# desde este entorno.
PARAM_SPEAKER_IDENTIFICATION = "speaker_identification"
SPEAKER_IDENTIFICATION = {
    "speaker_type": "role",
    "speakers": [
        {
            "role": "Terapeuta",
            "description": (
                "profesional que conduce la sesión de psicoterapia: saluda, "
                "encuadra, pregunta, señala"
            ),
        },
        {
            "role": "Paciente",
            "description": "persona consultante que relata su vivencia y responde",
        },
    ],
}

# Opciones de diarizacion. Una sesion de psicoterapia es diadica; fijar 2
# hablantes esperados mejora la separacion. Verificar nombre/forma en docs.
PARAM_SPEAKER_OPTIONS = "speaker_options"
SPEAKER_OPTIONS = {"min_speakers_expected": 2, "max_speakers_expected": 2}

ROL_TERAPEUTA = "Terapeuta"
ROL_PACIENTE = "Paciente"

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


def _crear_transcript(upload_url: str) -> str:
    payload = {
        "audio_url": upload_url,
        "speech_model": config.ASR_MODEL_ID,
        "language_code": "es",
        "speaker_labels": True,
        PARAM_SPEAKER_OPTIONS: SPEAKER_OPTIONS,
        PARAM_SPEAKER_IDENTIFICATION: SPEAKER_IDENTIFICATION,
    }
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
    """Polling hasta status completed/error o hasta ASR_TIMEOUT_SECONDS."""
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
    """DELETE best-effort: solo se loguea el status, nunca falla."""
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

def _normalizar(data: dict, transcript_id: str) -> dict:
    utterances = data.get("utterances") or []
    if not isinstance(utterances, list):
        utterances = []

    etiquetas = [
        str(u.get("speaker"))
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
        segments.append({
            "speaker": a_speaker(str(speaker)),
            "start": start,
            "end": end,
            "text": str(u.get("text") or ""),
        })

    duracion_reportada = data.get("audio_duration")
    if isinstance(duracion_reportada, (int, float)) and duracion_reportada > 0:
        duracion = float(duracion_reportada)
    else:
        duracion = max((s["end"] for s in segments), default=0.0)

    logger.info(
        f"AssemblyAI {transcript_id}: {len(utterances)} utterances, "
        f"{len(segments)} validas, {descartados} descartadas, "
        f"{duracion:.0f}s, hablantes={len(set(etiquetas))}, roles={roles_origen}"
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

"""
Transcripcion + diarizacion via servicio HTTP de VibeVoice.
"""
import logging
import os

import requests

import config

logger = logging.getLogger(__name__)

_DEFAULT_VIBEVOICE_URL = "http://100.71.155.25:8090/transcribe"
_TIMEOUT_SECONDS = 300


def _vibevoice_url() -> str:
    return getattr(
        config,
        "VIBEVOICE_URL",
        os.getenv("VIBEVOICE_URL", _DEFAULT_VIBEVOICE_URL),
    )


def transcribir(audio_path: str, hot_words: list[str] | None = None) -> dict:
    if hot_words:
        logger.warning("Hot words no soportadas por VibeVoice HTTP, ignoradas")

    url = _vibevoice_url()
    logger.info(f"Transcribiendo via {url}: {audio_path}")

    try:
        with open(audio_path, "rb") as f:
            response = requests.post(
                url,
                files={"file": (os.path.basename(audio_path), f, "audio/wav")},
                timeout=_TIMEOUT_SECONDS,
            )
    except requests.RequestException as e:
        raise RuntimeError(f"VibeVoice no responde en {url}: {e}") from e

    if not response.ok:
        raise RuntimeError(
            f"VibeVoice devolvio error {response.status_code}: {response.text[:500]}"
        )

    try:
        data = response.json()
    except ValueError as e:
        raise RuntimeError(f"VibeVoice devolvio respuesta no-JSON: {e}") from e

    segments = data.get("segments") or []
    duracion = max((s["end"] for s in segments), default=0)
    resultado = {"duration_seconds": int(duracion), "segments": segments}
    logger.info(f"Transcripcion: {len(segments)} segmentos, {duracion:.0f}s")
    return resultado


def formatear_para_llm(transcripcion: dict) -> str:
    lineas = []
    for seg in transcripcion.get("segments", []):
        minutos = int(seg["start"] // 60)
        segundos = int(seg["start"] % 60)
        timestamp = f"[{minutos:02d}:{segundos:02d}]"
        speaker = "Terapeuta" if seg["speaker"] == "S0" else "Paciente"
        lineas.append(f"{timestamp} {speaker}: {seg['text']}")
    return "\n".join(lineas)

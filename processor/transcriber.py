"""
Transcripcion + diarizacion via servicio HTTP de WhisperX (Atlas).
"""
import logging
import os

import requests

import config

logger = logging.getLogger(__name__)


def _mapear_segments(items: list) -> tuple[list[dict], int]:
    """
    Normaliza items de WhisperX al formato {speaker, start, end, text}.
    WhisperX ya entrega los speakers normalizados como S0/S1/... El wrapper
    FastAPI hace la conversion SPEAKER_00 -> S0 antes de devolver la respuesta.
    Items mal formados o sin speaker se descartan.
    """
    salida: list[dict] = []
    descartados = 0
    for item in items:
        if not isinstance(item, dict):
            descartados += 1
            continue
        speaker = item.get("speaker")
        start_val = item.get("start")
        end_val = item.get("end")
        if speaker is None or start_val is None or end_val is None:
            descartados += 1
            continue
        try:
            start = float(start_val)
            end = float(end_val)
        except (TypeError, ValueError):
            descartados += 1
            continue
        salida.append({
            "speaker": str(speaker),
            "start": start,
            "end": end,
            "text": item.get("text", ""),
        })
    return salida, descartados


def transcribir(audio_path: str, hot_words: list[str] | None = None) -> dict:
    if hot_words:
        logger.warning("Hot words no soportadas por WhisperX HTTP, ignoradas")

    url = config.ASR_URL
    logger.info(f"Transcribiendo via {url}: {audio_path}")

    try:
        with open(audio_path, "rb") as f:
            response = requests.post(
                url,
                files={"file": (os.path.basename(audio_path), f, "audio/wav")},
                timeout=config.ASR_TIMEOUT_SECONDS,
            )
    except requests.RequestException as e:
        raise RuntimeError(f"WhisperX no responde en {url}: {e}") from e

    if not response.ok:
        raise RuntimeError(
            f"WhisperX devolvio error {response.status_code}: {response.text[:500]}"
        )

    try:
        data = response.json()
    except ValueError as e:
        raise RuntimeError(f"WhisperX devolvio respuesta no-JSON: {e}") from e

    raw_items = data.get("segments") or []
    if not isinstance(raw_items, list):
        raw_items = []

    segments, descartados = _mapear_segments(raw_items)

    duracion_reportada = data.get("duration_seconds")
    if isinstance(duracion_reportada, (int, float)) and duracion_reportada > 0:
        duracion = float(duracion_reportada)
    else:
        duracion = max((s["end"] for s in segments), default=0.0)

    logger.info(
        f"Transcripcion: {len(raw_items)} totales, "
        f"{len(segments)} validos, {descartados} descartados, "
        f"{duracion:.0f}s (idioma={data.get('language', '?')})"
    )
    return {"duration_seconds": int(duracion), "segments": segments}


def formatear_para_llm(transcripcion: dict) -> str:
    lineas = []
    for seg in transcripcion.get("segments", []):
        minutos = int(seg["start"] // 60)
        segundos = int(seg["start"] % 60)
        timestamp = f"[{minutos:02d}:{segundos:02d}]"
        speaker = "Terapeuta" if seg["speaker"] == "S0" else "Paciente"
        lineas.append(f"{timestamp} {speaker}: {seg['text']}")
    return "\n".join(lineas)

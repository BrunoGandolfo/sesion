"""
Transcripcion + diarizacion via servicio HTTP de VibeVoice.
"""
import json
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


def _parsear_transcription(raw: str) -> list:
    """Extrae el array JSON del string crudo, despues del ultimo 'assistant\\n'."""
    if not raw:
        return []
    marker = "assistant\n"
    idx = raw.rfind(marker)
    payload = raw[idx + len(marker):] if idx >= 0 else raw
    payload = payload.strip()
    if not payload:
        return []
    try:
        items = json.loads(payload)
    except json.JSONDecodeError as e:
        logger.warning(f"No se pudo parsear array JSON de transcription: {e}")
        return []
    return items if isinstance(items, list) else []


def _mapear_segments(items: list) -> tuple[list[dict], int]:
    """
    Normaliza items al formato {speaker, start, end, text}. Acepta tanto el
    formato crudo de VibeVoice (Speaker/Start/End/Content) como un fallback ya
    en minusculas. Items sin Speaker (ruidos ambientales) o con speaker
    'unknown' se descartan.
    """
    salida: list[dict] = []
    descartados = 0
    for item in items:
        if not isinstance(item, dict):
            descartados += 1
            continue
        speaker_raw = item.get("Speaker")
        if speaker_raw is None:
            speaker_raw = item.get("speaker")
        if speaker_raw is None or speaker_raw == "unknown":
            descartados += 1
            continue
        start_val = item.get("Start", item.get("start"))
        end_val = item.get("End", item.get("end"))
        if start_val is None or end_val is None:
            descartados += 1
            continue
        try:
            start = float(start_val)
            end = float(end_val)
        except (TypeError, ValueError):
            descartados += 1
            continue
        text = item.get("Content", item.get("text", ""))
        if isinstance(speaker_raw, bool) or not isinstance(speaker_raw, int):
            s = str(speaker_raw)
            speaker = s if s.startswith("S") else f"S{s}"
        else:
            speaker = f"S{speaker_raw}"
        salida.append({"speaker": speaker, "start": start, "end": end, "text": text})
    return salida, descartados


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

    raw_items = _parsear_transcription(data.get("transcription") or "")
    fuente = "transcription"

    if not raw_items:
        fallback = data.get("segments") or []
        if isinstance(fallback, list) and fallback:
            raw_items = fallback
            fuente = "segments"

    segments, descartados = _mapear_segments(raw_items)
    duracion = max((s["end"] for s in segments), default=0.0)
    logger.info(
        f"Transcripcion ({fuente}): {len(raw_items)} totales, "
        f"{len(segments)} validos, {descartados} descartados sin speaker, "
        f"{duracion:.0f}s"
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

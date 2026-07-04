"""Compute speech analytics from diarized ASR segments (WhisperX)."""

SILENCIO_UMBRAL_SEG = 3.0


def _zeros() -> dict:
    return {
        "ratioHablaTerapeuta": 0.0,
        "ratioHablaPaciente": 0.0,
        "cantidadSilencios": 0,
        "duracionPromedioSilenciosSeg": 0.0,
        "tiempoTotalHablaSeg": 0.0,
        "speakersDetectados": 0,
    }


def compute(segments: list[dict]) -> dict:
    """Compute speech analytics from diarized ASR segments.

    Args:
        segments: list of {"speaker": "S0"|"S1"|..., "start": float, "end": float, "text": str}
            S0 = Terapeuta, S1+ = Paciente (S2, S3... agrupados como paciente)

    Returns:
        dict with ratios, silences and total time. All zeros if segments is empty.
    """
    if not segments:
        return _zeros()

    tiempo_terapeuta = 0.0
    tiempo_paciente = 0.0

    for seg in segments:
        dur = max(0.0, float(seg["end"]) - float(seg["start"]))
        if seg["speaker"] == "S0":
            tiempo_terapeuta += dur
        else:
            tiempo_paciente += dur

    tiempo_total = max(float(s["end"]) for s in segments)

    if tiempo_total > 0:
        ratio_terapeuta = round((tiempo_terapeuta / tiempo_total) * 100, 1)
        ratio_paciente = round((tiempo_paciente / tiempo_total) * 100, 1)
    else:
        ratio_terapeuta = 0.0
        ratio_paciente = 0.0

    ordenados = sorted(segments, key=lambda s: float(s["start"]))
    silencios = []
    for prev, curr in zip(ordenados, ordenados[1:]):
        gap = float(curr["start"]) - float(prev["end"])
        if gap > SILENCIO_UMBRAL_SEG:
            silencios.append(gap)

    cantidad_silencios = len(silencios)
    duracion_promedio = round(sum(silencios) / cantidad_silencios, 2) if silencios else 0.0

    return {
        "ratioHablaTerapeuta": ratio_terapeuta,
        "ratioHablaPaciente": ratio_paciente,
        "cantidadSilencios": cantidad_silencios,
        "duracionPromedioSilenciosSeg": duracion_promedio,
        "tiempoTotalHablaSeg": round(tiempo_total, 2),
        "speakersDetectados": len({s["speaker"] for s in segments if "speaker" in s}),
    }

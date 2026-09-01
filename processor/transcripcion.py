"""
Formateo de la transcripcion diarizada para los prompts del LLM.
"""


def formatear_para_llm(transcripcion: dict) -> str:
    """
    Convierte los segments normalizados ({speaker: S0|S1, start, end, text})
    al formato que esperan los prompts:
        [MM:SS] Terapeuta: texto
        [MM:SS] Paciente: texto
    S0 = Terapeuta; cualquier otro speaker = Paciente.
    """
    lineas = []
    for seg in transcripcion.get("segments", []):
        minutos = int(seg["start"] // 60)
        segundos = int(seg["start"] % 60)
        timestamp = f"[{minutos:02d}:{segundos:02d}]"
        speaker = "Terapeuta" if seg["speaker"] == "S0" else "Paciente"
        lineas.append(f"{timestamp} {speaker}: {seg['text']}")
    return "\n".join(lineas)

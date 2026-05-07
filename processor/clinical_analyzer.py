"""
Genera nota clinica SOAP a partir de transcripcion usando LLM.
"""
import json
import logging
import os
import re
import requests
import config

logger = logging.getLogger(__name__)

def _cargar_prompt() -> str:
    prompt_path = os.path.join(config.PROMPTS_DIR, "clinical_note_v2.1.md")
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Prompt no encontrado: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()

def _llamar_ollama(system_prompt: str, transcripcion: str) -> str:
    url = f"{config.OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": config.LLM_MODEL_ID,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcripcion},
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 8192},
    }
    logger.info(f"Llamando Ollama ({config.LLM_MODEL_ID})...")
    response = requests.post(url, json=payload, timeout=300)
    response.raise_for_status()
    return response.json()["message"]["content"]

def _llamar_vllm(system_prompt: str, transcripcion: str) -> str:
    url = f"{config.VLLM_BASE_URL}/v1/chat/completions"
    payload = {
        "model": config.LLM_MODEL_ID,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcripcion},
        ],
        "temperature": 0.3,
        "max_tokens": 8192,
    }
    logger.info(f"Llamando vLLM ({config.LLM_MODEL_ID})...")
    response = requests.post(url, json=payload, timeout=300)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]

def _parsear_respuesta(raw: str) -> dict:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        start = 1 if lines[0].strip().startswith("```") else 0
        end = len(lines)
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip() == "```":
                end = i
                break
        cleaned = "\n".join(lines[start:end]).strip()
    if "<think>" in cleaned:
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"JSON invalido del LLM: {e}")
        logger.error(f"Raw (500 chars): {cleaned[:500]}")
        raise ValueError(f"LLM no devolvio JSON valido: {e}")

def analizar(transcripcion_formateada: str, sesiones_previas: list[dict] | None = None) -> dict:
    system_prompt = _cargar_prompt()
    user_content = f"TRANSCRIPCION DE LA SESION:\n\n{transcripcion_formateada}"
    if sesiones_previas and len(sesiones_previas) >= 4:
        contexto = "\n\n---\n\n".join(
            f"SESION ANTERIOR ({i+1}):\n{json.dumps(s, ensure_ascii=False, indent=2)}"
            for i, s in enumerate(sesiones_previas[-5:])
        )
        user_content = (
            f"CONTEXTO: {len(sesiones_previas)} sesiones anteriores.\n\n"
            f"{contexto}\n\n---\n\n{user_content}\n\n"
            f"Inclui materialRecurrente y materialNuevo comparando con sesiones anteriores."
        )
    if config.LLM_BACKEND == "ollama":
        user_content += "\n\n/no_think"
        raw = _llamar_ollama(system_prompt, user_content)
    elif config.LLM_BACKEND == "vllm":
        raw = _llamar_vllm(system_prompt, user_content)
    else:
        raise ValueError(f"Backend no soportado: {config.LLM_BACKEND}")
    resultado = _parsear_respuesta(raw)
    if "nota" not in resultado:
        raise ValueError("Respuesta sin 'nota'")
    if "datosEstructurados" not in resultado:
        raise ValueError("Respuesta sin 'datosEstructurados'")
    for campo in ("subjetivo", "objetivo", "analisis", "plan"):
        if campo not in resultado["nota"]:
            raise ValueError(f"Nota SOAP incompleta: falta '{campo}'")
    logger.info("Nota clinica generada")
    return resultado

def version_prompt() -> str:
    return "v2.1"

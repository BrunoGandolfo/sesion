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

PROMPT_NOTA_SOAP = "clinical_note_v2.1.md"
PROMPT_UPDATE_CONTEXTO = "update_context_v1.md"


def _cargar_prompt(nombre: str) -> str:
    prompt_path = os.path.join(config.PROMPTS_DIR, nombre)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Prompt no encontrado: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def _llamar_ollama(system_prompt: str, user_content: str) -> str:
    url = f"{config.OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": config.LLM_MODEL_ID,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 8192},
    }
    logger.info(f"Llamando Ollama ({config.LLM_MODEL_ID})...")
    response = requests.post(url, json=payload, timeout=300)
    response.raise_for_status()
    return response.json()["message"]["content"]


def _llamar_vllm(system_prompt: str, user_content: str) -> str:
    url = f"{config.VLLM_BASE_URL}/v1/chat/completions"
    payload = {
        "model": config.LLM_MODEL_ID,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.3,
        "max_tokens": 8192,
    }
    logger.info(f"Llamando vLLM ({config.LLM_MODEL_ID})...")
    response = requests.post(url, json=payload, timeout=300)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _llamar_llm(system_prompt: str, user_content: str) -> str:
    if config.LLM_BACKEND == "ollama":
        return _llamar_ollama(system_prompt, user_content + "\n\n/no_think")
    if config.LLM_BACKEND == "vllm":
        return _llamar_vllm(system_prompt, user_content)
    raise ValueError(f"Backend no soportado: {config.LLM_BACKEND}")


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


def analizar(
    transcripcion_formateada: str,
    contexto_clinico: str | None = None,
) -> dict:
    """
    Genera la nota SOAP. Si `contexto_clinico` está presente (string
    pre-formateado por el endpoint /contexto-clinico?format=llm), se inyecta
    en un bloque <contexto_previo> antes de la transcripcion.
    """
    system_prompt = _cargar_prompt(PROMPT_NOTA_SOAP)

    bloques = []
    if contexto_clinico and contexto_clinico.strip():
        bloques.append(
            "<contexto_previo>\n"
            f"{contexto_clinico.strip()}\n"
            "</contexto_previo>"
        )
    bloques.append(f"TRANSCRIPCION DE LA SESION:\n\n{transcripcion_formateada}")
    user_content = "\n\n".join(bloques)

    raw = _llamar_llm(system_prompt, user_content)
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


def actualizar_contexto_clinico(
    contexto_previo: dict,
    nota: dict,
    datos_estructurados: dict,
) -> dict:
    """
    Llamada B: a partir del PacienteContextoClinico previo y la nota SOAP
    recien aprobada, devuelve el contexto actualizado segun el prompt
    update_context_v1.md. Output es el objeto completo (no diff).
    """
    system_prompt = _cargar_prompt(PROMPT_UPDATE_CONTEXTO)
    nota_soap = {"nota": nota, "datosEstructurados": datos_estructurados}
    user_content = (
        "<contexto_previo>\n"
        f"{json.dumps(contexto_previo or {}, ensure_ascii=False, indent=2)}\n"
        "</contexto_previo>\n\n"
        "<nota_soap_aprobada>\n"
        f"{json.dumps(nota_soap, ensure_ascii=False, indent=2)}\n"
        "</nota_soap_aprobada>"
    )

    raw = _llamar_llm(system_prompt, user_content)
    actualizado = _parsear_respuesta(raw)
    logger.info("Contexto clinico actualizado (Llamada B)")
    return actualizado


def version_prompt() -> str:
    return "v2.1"

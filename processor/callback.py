"""
Envía resultados del procesamiento al callback de la app.
"""
import logging
import requests
import config

logger = logging.getLogger(__name__)

def enviar_resultado(
    sesion_clinica_id: str,
    estado: str,
    transcripcion: str | None = None,
    nota: dict | None = None,
    datos_estructurados: dict | None = None,
    modelo_asr: str | None = None,
    modelo_llm: str | None = None,
    error: str | None = None,
) -> bool:
    url = f"{config.APP_BASE_URL}/api/sesion-clinica/callback"
    payload = {"sesionClinicaId": sesion_clinica_id, "estado": estado}
    if transcripcion:
        payload["transcripcion"] = transcripcion
    if nota:
        payload["nota"] = nota
    if datos_estructurados:
        payload["datosEstructurados"] = datos_estructurados
    if modelo_asr:
        payload["modeloASR"] = modelo_asr
    if modelo_llm:
        payload["modeloLLM"] = modelo_llm
    if error:
        payload["error"] = error
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.PROCESSING_SECRET}",
    }
    try:
        logger.info(f"Callback: {sesion_clinica_id} -> {estado}")
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        logger.info(f"Callback OK: {response.status_code}")
        return True
    except requests.RequestException as e:
        logger.error(f"Callback error: {e}")
        return False

"""
Envía resultados del procesamiento al callback de la app.

Semántica de respuesta (contrato app<->worker):
  2xx  -> ok
  409  -> la sesión ya no está en "procesando": no reintentar, solo loguear
  4xx  -> error de contrato: loguear status, no reintentar
  5xx / sin respuesta -> dejar que el lease de la app reintente
Nunca se loguea el payload (contiene transcripción y nota).
"""
import logging
from dataclasses import dataclass

import requests

import config

logger = logging.getLogger(__name__)


@dataclass
class CallbackResultado:
    ok: bool
    status: int | None


def _error_del_body(response: requests.Response) -> str:
    """Primeros 120 chars del campo `error` del body (texto de la app, no PHI)."""
    try:
        body = response.json()
    except ValueError:
        return ""
    if isinstance(body, dict) and body.get("error"):
        return str(body["error"])[:120]
    return ""


def enviar_resultado(
    sesion_clinica_id: str,
    estado: str,
    transcripcion: str | None = None,
    nota: dict | None = None,
    datos_estructurados: dict | None = None,
    modelo_asr: str | None = None,
    modelo_llm: str | None = None,
    error: str | None = None,
    prompt_version: str | None = None,
) -> CallbackResultado:
    payload: dict = {"sesionClinicaId": sesion_clinica_id, "estado": estado}
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
    if prompt_version:
        payload["promptVersion"] = prompt_version
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.PROCESSING_SECRET}",
    }

    logger.info(f"Callback: {sesion_clinica_id} -> {estado}")
    try:
        response = requests.post(config.CALLBACK_URL, json=payload, headers=headers, timeout=30)
    except requests.RequestException as e:
        logger.error(f"Callback {sesion_clinica_id}: sin respuesta ({type(e).__name__})")
        return CallbackResultado(ok=False, status=None)

    status = response.status_code
    if 200 <= status < 300:
        logger.info(f"Callback OK: {status}")
        return CallbackResultado(ok=True, status=status)

    detalle = _error_del_body(response)
    sufijo = f" error={detalle}" if detalle else ""
    if status == 409:
        logger.warning(f"Callback {sesion_clinica_id}: 409, sesion ya no esta en procesando{sufijo}")
    elif 400 <= status < 500:
        logger.error(f"Callback {sesion_clinica_id}: error de contrato HTTP {status}{sufijo}")
    else:
        logger.error(f"Callback {sesion_clinica_id}: HTTP {status}{sufijo}")
    return CallbackResultado(ok=False, status=status)

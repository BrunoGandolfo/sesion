"""
Cliente HTTP unico hacia la app Sesion (Vercel).

Todo lo que el worker le pide a la app pasa por aca: el header Bearer se
arma en un solo lugar, los timeouts son constantes y la interpretacion de
los status es una sola.

Contrato de respuestas de la app:
  GET  /api/sesion-clinica/pendientes              -> lista de SesionReclamada
  GET  /api/sesion-clinica/aprobadas-sin-contexto  -> lista de SesionSinContexto
  GET  /api/pacientes/{id}/contexto-clinico?format=llm -> texto (404 si no hay)
  POST /api/sesion-clinica/callback                -> 2xx ok
                                                      409 la sesion ya no esta
                                                          en "procesando"
                                                      4xx error de contrato
                                                      5xx / sin respuesta:
                                                          el lease reintenta
  PATCH /api/pacientes/{id}/contexto-clinico       -> 2xx ok; otro: error

Privacidad de logs: solo ids, status y el campo `error` de la app (120
chars). Nunca el payload: contiene transcripcion, nota y contexto.
"""
import logging
from dataclasses import dataclass

import requests

import config

logger = logging.getLogger(__name__)

TIMEOUT_LECTURA_SEG = 15   # GETs: pendientes, aprobadas, contexto para el LLM
TIMEOUT_ESCRITURA_SEG = 30  # POST callback, PATCH contexto


def _headers(con_json: bool = False) -> dict:
    """Unico lugar donde se construye la autenticacion M2M."""
    h = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    if con_json:
        h["Content-Type"] = "application/json"
    return h


def _error_del_body(response: requests.Response) -> str:
    """Primeros 120 chars del campo `error` del body (texto de la app, no PHI)."""
    try:
        body = response.json()
    except ValueError:
        return ""
    if isinstance(body, dict) and body.get("error"):
        return str(body["error"])[:120]
    return ""


def _lista(url: str) -> list[dict]:
    """GET autenticado que espera una lista JSON. Lanza requests.RequestException."""
    response = requests.get(url, headers=_headers(), timeout=TIMEOUT_LECTURA_SEG)
    response.raise_for_status()
    body = response.json()
    return body if isinstance(body, list) else []


# Lecturas ──────────────────────────────────────────────────────────────────

def obtener_pendientes() -> list[dict]:
    """Sesiones en "procesando" reclamadas por lease (ver reclamar-pendientes.ts)."""
    return _lista(config.PENDIENTES_URL)


def obtener_aprobadas_sin_contexto() -> list[dict]:
    """Sesiones aprobadas todavia no integradas al contexto longitudinal."""
    return _lista(config.APROBADAS_URL)


def obtener_contexto_clinico_llm(paciente_id: str) -> str | None:
    """
    Contexto longitudinal pre-formateado para el prompt de la nota. None si
    404 o si falla la red: es best-effort, nunca frena el pipeline.
    """
    try:
        response = requests.get(
            config.contexto_clinico_url(paciente_id),
            params={"format": "llm"},
            headers=_headers(),
            timeout=TIMEOUT_LECTURA_SEG,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        texto = response.text.strip()
        return texto or None
    except Exception as e:
        logger.warning(f"Contexto clinico (LLM) no disponible ({type(e).__name__})")
        return None


# Callback ──────────────────────────────────────────────────────────────────

@dataclass
class RespuestaCallback:
    ok: bool
    status: int | None  # None = sin respuesta (error de red)

    @property
    def terminal(self) -> bool:
        """
        True si el callback cerro el ciclo de la sesion: 2xx, 409 (la app ya
        la movio de estado) o 4xx (error de contrato, reintentar no ayuda).
        False con 5xx o sin respuesta: el lease de la app reintentara.
        """
        if self.ok or self.status == 409:
            return True
        return self.status is not None and 400 <= self.status < 500


def enviar_callback(
    sesion_clinica_id: str,
    estado: str,
    transcripcion: str | None = None,
    nota: dict | None = None,
    datos_estructurados: dict | None = None,
    modelo_asr: str | None = None,
    modelo_llm: str | None = None,
    error: str | None = None,
    prompt_version: str | None = None,
) -> RespuestaCallback:
    """POST al callback. Nunca lanza: la clasificacion va en RespuestaCallback."""
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

    logger.info(f"Callback: {sesion_clinica_id} -> {estado}")
    try:
        response = requests.post(
            config.CALLBACK_URL,
            json=payload,
            headers=_headers(con_json=True),
            timeout=TIMEOUT_ESCRITURA_SEG,
        )
    except requests.RequestException as e:
        logger.error(f"Callback {sesion_clinica_id}: sin respuesta ({type(e).__name__})")
        return RespuestaCallback(ok=False, status=None)

    status = response.status_code
    if 200 <= status < 300:
        logger.info(f"Callback OK: {status}")
        return RespuestaCallback(ok=True, status=status)

    detalle = _error_del_body(response)
    sufijo = f" error={detalle}" if detalle else ""
    if status == 409:
        logger.warning(
            f"Callback {sesion_clinica_id}: 409, sesion ya no esta en procesando; "
            f"se descarta el resultado{sufijo}"
        )
    elif 400 <= status < 500:
        logger.error(
            f"Callback {sesion_clinica_id}: rechazado por contrato HTTP {status}; "
            f"no se reintenta{sufijo}"
        )
    else:
        logger.error(f"Callback {sesion_clinica_id}: HTTP {status}{sufijo}")
    return RespuestaCallback(ok=False, status=status)


# Contexto longitudinal ─────────────────────────────────────────────────────

def actualizar_contexto(paciente_id: str, cambios: dict) -> int:
    """
    PATCH del PacienteContextoClinico. Devuelve el status; lanza RuntimeError
    con el status si la app no respondio 2xx (el llamador decide el backoff).
    """
    response = requests.patch(
        config.contexto_clinico_url(paciente_id),
        json=cambios,
        headers=_headers(con_json=True),
        timeout=TIMEOUT_ESCRITURA_SEG,
    )
    if not response.ok:
        raise RuntimeError(f"PATCH contexto-clinico respondio HTTP {response.status_code}")
    return response.status_code

"""
Llamada B fuera de linea: actualiza el contexto clinico longitudinal de las
sesiones ya APROBADAS que todavia no fueron integradas.

Flujo por ciclo:
  GET  /api/sesion-clinica/aprobadas-sin-contexto
  por cada item: LLM (update_context) -> PATCH /api/pacientes/{id}/contexto-clinico

Backoff en memoria por sesion: 1er fallo espera 5 min, 2do 30 min, 3er fallo
queda en ERROR y no se reintenta hasta reiniciar el proceso.
Nunca propaga excepciones. Loguea solo ids, prompt y status.
"""
import logging
import math
import time

import requests

import config
from clinical_analyzer import actualizar_contexto_clinico
from errores import PipelineError

logger = logging.getLogger(__name__)

# Unicas claves que acepta el zod updateSchema del PATCH.
CLAVES_PATCH = (
    "hipotesisDiagnostica",
    "resumenAcumulativo",
    "objetivosTerapeuticos",
    "intervencionesProbadas",
    "temasRecurrentes",
    "riesgosHistoricos",
    "ultimaSesionId",
)

_ESPERAS_SEG = (5 * 60, 30 * 60)
_MAX_FALLOS = 3

# sesionClinicaId -> (fallos, epoch del proximo intento)
_backoff: dict[str, tuple[int, float]] = {}


def _headers() -> dict:
    return {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}


def _consultar_aprobadas() -> list[dict]:
    response = requests.get(config.APROBADAS_URL, headers=_headers(), timeout=15)
    response.raise_for_status()
    body = response.json()
    return body if isinstance(body, list) else []


def _puede_intentar(sesion_id: str) -> bool:
    entrada = _backoff.get(sesion_id)
    if entrada is None:
        return True
    _, proximo = entrada
    return time.time() >= proximo


def _registrar_fallo(sesion_id: str, e: Exception) -> None:
    if isinstance(e, PipelineError):
        motivo = f"{e.codigo}: {e.mensaje_publico}"
    else:
        motivo = f"{type(e).__name__}: {str(e)[:200]}"

    fallos = _backoff.get(sesion_id, (0, 0.0))[0] + 1
    if fallos >= _MAX_FALLOS:
        _backoff[sesion_id] = (fallos, math.inf)
        logger.error(
            f"Contexto {sesion_id}: fallo {fallos}/{_MAX_FALLOS} ({motivo}); "
            "no se reintenta hasta reiniciar el worker"
        )
        return
    espera = _ESPERAS_SEG[fallos - 1]
    _backoff[sesion_id] = (fallos, time.time() + espera)
    logger.warning(
        f"Contexto {sesion_id}: fallo {fallos}/{_MAX_FALLOS} ({motivo}); "
        f"reintento en {espera // 60} min"
    )


def _procesar_item(item: dict) -> None:
    sesion_id = item["sesionClinicaId"]
    paciente_id = item["pacienteId"]
    fecha = (item.get("fechaSesion") or "")[:10] or None
    try:
        numero_sesion = int(item.get("numeroSesion") or 0)
    except (TypeError, ValueError):
        numero_sesion = 0

    contexto_previo = item.get("contextoActual") or {}
    actualizado, prompt = actualizar_contexto_clinico(
        contexto_previo,
        item["nota"],
        item.get("datosEstructurados") or {},
        sesion_clinica_id=sesion_id,
        fecha=fecha,
        numero_sesion=numero_sesion,
    )
    actualizado["ultimaSesionId"] = sesion_id
    body = {k: actualizado[k] for k in CLAVES_PATCH if k in actualizado}

    response = requests.patch(
        config.contexto_clinico_url(paciente_id),
        json=body,
        headers=_headers(),
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"PATCH contexto-clinico respondio HTTP {response.status_code}")
    logger.info(f"Contexto {sesion_id}: actualizado ({prompt}, HTTP {response.status_code})")


def procesar_aprobadas() -> None:
    try:
        items = _consultar_aprobadas()
    except Exception as e:
        logger.warning(f"Contexto: no se pudo consultar aprobadas ({type(e).__name__})")
        return
    if not items:
        return

    logger.info(f"Contexto: {len(items)} sesion(es) aprobada(s) sin integrar")
    for item in items:
        if not isinstance(item, dict):
            continue
        sesion_id = item.get("sesionClinicaId")
        if not sesion_id or not item.get("pacienteId") or not isinstance(item.get("nota"), dict):
            logger.warning(f"Contexto: item incompleto (sesion={sesion_id or '?'}), ignorado")
            continue
        if not _puede_intentar(sesion_id):
            continue
        try:
            _procesar_item(item)
            _backoff.pop(sesion_id, None)
        except Exception as e:
            _registrar_fallo(sesion_id, e)

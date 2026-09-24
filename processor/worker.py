"""
Worker principal del servicio de procesamiento de sesiones clinicas.

Modo loop (default):
    python worker.py
    Cada POLL_INTERVAL_SECONDS: reclama /api/sesion-clinica/pendientes y
    procesa cada sesion; despues reclama /api/trabajos/pendientes (borrar el
    transcript en AssemblyAI, generar "Para vos") y los resuelve.

Modo manual:
    python worker.py manual <item.json>
    con el JSON de UNA sesion tal como la entrega /pendientes (con ticket).

La app aplica un lease de 5 minutos que este worker renueva cada minuto
mientras trabaja; una sesion cuyo worker murio se vuelve a entregar con
intento + 1, y el resultado de un intento viejo se rechaza. Los fallos
transitorios vuelven a la cola con backoff; a los 5 seguidos la app la da
por fallida. El worker no reintenta por su cuenta.
"""
import json
import logging
import signal
import sys
import time

import requests

import app_client
import config
import processor
from processor import SesionReclamada, procesar_sesion

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("sesion-worker")

_running = True


def _signal_handler(sig, frame):
    global _running
    if _running:
        logger.info("Senal recibida, terminando despues de la sesion actual...")
        _running = False
    else:
        logger.warning("Segunda senal recibida, forzando salida")
        sys.exit(1)


def _dormir_interrumpible(segundos: int) -> None:
    """Sleep que se corta apenas _running pasa a False."""
    for _ in range(max(0, segundos)):
        if not _running:
            return
        time.sleep(1)


def _procesar_pendientes(items: list[dict]) -> None:
    for item in items:
        if not _running:
            logger.info("Shutdown solicitado, no se toman mas sesiones de este ciclo")
            return
        sesion = SesionReclamada.desde_item(item)
        if not sesion:
            # Nunca loguear el item completo: trae el ticket.
            logger.warning(
                f"Item ignorado por falta de campos: sesion={item.get('sesionClinicaId') or '?'}"
                if isinstance(item, dict)
                else "Item ignorado: no es un objeto"
            )
            continue
        logger.info(
            f"Procesando sesion {sesion.sesion_clinica_id} (intento {sesion.intento}, "
            f"{'checkpoint' if sesion.checkpoint else 'audio'})"
        )
        try:
            procesar_sesion(sesion)
            logger.info(f"Sesion {sesion.sesion_clinica_id} terminada")
        except Exception as e:
            # procesar_sesion captura todo internamente; esto es solo red de seguridad.
            logger.error(f"Error procesando {sesion.sesion_clinica_id}: {type(e).__name__}", exc_info=True)


def _procesar_trabajos(trabajos: list[dict]) -> None:
    for trabajo in trabajos:
        if not _running:
            return
        trabajo_id = trabajo.get("trabajoId") if isinstance(trabajo, dict) else None
        ticket = trabajo.get("ticket") if isinstance(trabajo, dict) else None
        if not trabajo_id or not ticket:
            logger.warning("Trabajo ignorado: sin trabajoId o ticket")
            continue
        logger.info(f"Trabajo {trabajo_id} ({trabajo.get('tipo')}, intento {trabajo.get('intentos')})")
        resultado = processor.ejecutar_trabajo(trabajo)
        res = app_client.resolver_trabajo(trabajo_id, ticket, resultado)
        if not res.ok:
            logger.warning(f"Trabajo {trabajo_id}: la app respondio {res.status}")


def _ciclo() -> None:
    try:
        pendientes = app_client.obtener_pendientes()
    except requests.RequestException as e:
        logger.error(f"Error consultando pendientes ({type(e).__name__})")
        return
    if pendientes:
        logger.info(f"{len(pendientes)} sesion(es) pendiente(s)")
        _procesar_pendientes(pendientes)
    else:
        logger.info("Sin sesiones pendientes")

    if not _running:
        return
    try:
        trabajos = app_client.trabajos_pendientes(processor.TIPOS_TRABAJO)
    except requests.RequestException as e:
        logger.error(f"Error consultando trabajos ({type(e).__name__})")
        return
    if trabajos:
        logger.info(f"{len(trabajos)} trabajo(s)")
        _procesar_trabajos(trabajos)


def loop_principal() -> None:
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    logger.info("=== Sesion Processor Worker iniciado ===")
    logger.info(f"  App:    {config.APP_BASE_URL}")
    logger.info(f"  ASR:    assemblyai:{config.ASR_MODEL_ID}")
    logger.info(f"  LLM:    {processor.MODELO_LLM}")
    logger.info(f"  Worker: {config.WORKER_VERSION} ({app_client.WORKER_ID})")
    logger.info(f"  R2:     {'si' if config.r2_configurado() else 'NO'}")
    logger.info(f"  Poll:   cada {config.POLL_INTERVAL_SECONDS}s")

    while _running:
        try:
            _ciclo()
        except Exception as e:
            logger.error(f"Error inesperado en el loop: {type(e).__name__}", exc_info=True)
        if _running:
            _dormir_interrumpible(config.POLL_INTERVAL_SECONDS)

    logger.info("=== Worker detenido ===")


def procesar_modo_manual(ruta_item: str) -> bool:
    try:
        with open(ruta_item, encoding="utf-8") as f:
            item = json.load(f)
    except (OSError, ValueError) as e:
        logger.error(f"No se pudo leer {ruta_item}: {type(e).__name__}")
        return False
    sesion = SesionReclamada.desde_item(item)
    if not sesion:
        logger.error("El item no tiene la forma de una sesion reclamada (sesionClinicaId, intento, ticket, audio o checkpoint)")
        return False
    logger.info(f"=== Procesamiento manual: {sesion.sesion_clinica_id} ===")
    try:
        procesar_sesion(sesion)
        logger.info("=== Procesamiento manual terminado ===")
        return True
    except Exception as e:
        logger.error(f"=== Procesamiento manual fallo: {type(e).__name__} ===", exc_info=True)
        return False


def main() -> None:
    config.validar_config()
    if len(sys.argv) > 1 and sys.argv[1] == "manual":
        if len(sys.argv) < 3:
            print("Uso: python worker.py manual <item.json>")
            sys.exit(1)
        sys.exit(0 if procesar_modo_manual(sys.argv[2]) else 1)
    loop_principal()


if __name__ == "__main__":
    main()

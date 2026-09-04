"""
Worker principal del servicio de procesamiento de sesiones clinicas.

Modo loop (default):
    python worker.py
    Cada POLL_INTERVAL_SECONDS: procesa /api/sesion-clinica/pendientes y
    luego integra /api/sesion-clinica/aprobadas-sin-contexto.

Modo manual:
    python worker.py manual <sesion_clinica_id> <audio_r2_key> <clave_cifrado> <iv>

La app aplica un lease sobre las pendientes (re-entrega a los 45 min con
intento+1, error automatico al superar 3 intentos): el worker no reintenta
por su cuenta.
"""
import logging
import signal
import sys
import time

import requests

import app_client
import config
import contexto_worker
from processor import procesar_sesion

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


# Campos obligatorios de cada item de /pendientes (SesionReclamada en
# src/app/api/_lib/casos-uso/reclamar-pendientes.ts). audioR2Key, claveCifrado
# e iv pueden venir null: en ese caso el item se ignora.
_CAMPOS_OBLIGATORIOS = ("sesionClinicaId", "audioR2Key", "claveCifrado", "iv")


def _extraer_args(
    item: dict,
) -> tuple[str, str, str, str, str | None, str, int] | None:
    if any(not item.get(campo) for campo in _CAMPOS_OBLIGATORIOS):
        return None
    try:
        intento = int(item.get("intento") or 1)
    except (TypeError, ValueError):
        intento = 1
    return (
        item["sesionClinicaId"],
        item["audioR2Key"],
        item["claveCifrado"],
        item["iv"],
        item.get("pacienteId") or None,
        item.get("orientacionTeorica") or "cbt_mi",
        intento,
    )


def _procesar_pendientes(items: list[dict]) -> None:
    for item in items:
        if not _running:
            logger.info("Shutdown solicitado, no se toman mas sesiones de este ciclo")
            return
        args = _extraer_args(item)
        if not args:
            # Nunca loguear el item completo: trae claveCifrado e iv.
            # Solo el id y que campos faltan.
            faltan = [campo for campo in _CAMPOS_OBLIGATORIOS if not item.get(campo)]
            logger.warning(
                f"Item ignorado por falta de campos: sesion={item.get('sesionClinicaId') or '?'} "
                f"faltan={','.join(faltan) or '?'}"
            )
            continue
        sesion_id, audio_key, clave, iv, paciente_id, orientacion, intento = args
        logger.info(f"Procesando sesion {sesion_id} (audio: {audio_key}, intento {intento})")
        try:
            procesar_sesion(
                sesion_clinica_id=sesion_id,
                audio_r2_key=audio_key,
                clave_cifrado=clave,
                iv_cifrado=iv,
                paciente_id=paciente_id,
                orientacion_teorica=orientacion,
                intento=intento,
            )
            logger.info(f"Sesion {sesion_id} procesada")
        except Exception as e:
            # procesar_sesion captura todo internamente; esto es solo red de seguridad.
            logger.error(f"Error procesando {sesion_id}: {type(e).__name__}", exc_info=True)


def loop_principal() -> None:
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    logger.info("=== Sesion Processor Worker iniciado ===")
    logger.info(f"  App:    {config.APP_BASE_URL}")
    logger.info(f"  ASR:    assemblyai:{config.ASR_MODEL_ID}")
    logger.info(f"  LLM:    {config.LLM_BACKEND}:{config.LLM_MODEL_ID}")
    logger.info(f"  Worker: {config.WORKER_VERSION}")
    logger.info(f"  R2:     {'si' if config.r2_configurado() else 'NO'}")
    logger.info(f"  Poll:   cada {config.POLL_INTERVAL_SECONDS}s")

    while _running:
        try:
            pendientes = app_client.obtener_pendientes()
        except requests.RequestException as e:
            logger.error(f"Error consultando pendientes ({type(e).__name__})")
            _dormir_interrumpible(config.POLL_INTERVAL_SECONDS)
            continue
        except Exception as e:
            logger.error(f"Error inesperado en el loop: {type(e).__name__}", exc_info=True)
            _dormir_interrumpible(config.POLL_INTERVAL_SECONDS)
            continue

        if pendientes:
            logger.info(f"{len(pendientes)} sesion(es) pendiente(s)")
            _procesar_pendientes(pendientes)
        else:
            logger.info("Sin sesiones pendientes")

        if _running:
            try:
                contexto_worker.procesar_aprobadas()
            except Exception as e:
                logger.error(f"Error en contexto_worker: {type(e).__name__}", exc_info=True)

        if _running:
            _dormir_interrumpible(config.POLL_INTERVAL_SECONDS)

    logger.info("=== Worker detenido ===")


def procesar_modo_manual(
    sesion_clinica_id: str,
    audio_r2_key: str,
    clave_cifrado: str,
    iv_cifrado: str,
    orientacion_teorica: str = "cbt_mi",
) -> bool:
    logger.info(f"=== Procesamiento manual: {sesion_clinica_id} ===")
    try:
        procesar_sesion(
            sesion_clinica_id=sesion_clinica_id,
            audio_r2_key=audio_r2_key,
            clave_cifrado=clave_cifrado,
            iv_cifrado=iv_cifrado,
            orientacion_teorica=orientacion_teorica,
        )
        logger.info("=== Procesamiento manual terminado ===")
        return True
    except Exception as e:
        logger.error(f"=== Procesamiento manual fallo: {type(e).__name__} ===", exc_info=True)
        return False


def main() -> None:
    config.validar_config()
    if len(sys.argv) > 1 and sys.argv[1] == "manual":
        if len(sys.argv) < 6:
            print(
                "Uso: python worker.py manual <sesion_clinica_id> <audio_r2_key> "
                "<clave_cifrado> <iv> [orientacion_teorica]"
            )
            sys.exit(1)
        ok = procesar_modo_manual(
            sesion_clinica_id=sys.argv[2],
            audio_r2_key=sys.argv[3],
            clave_cifrado=sys.argv[4],
            iv_cifrado=sys.argv[5],
            orientacion_teorica=sys.argv[6] if len(sys.argv) > 6 else "cbt_mi",
        )
        sys.exit(0 if ok else 1)
    loop_principal()


if __name__ == "__main__":
    main()

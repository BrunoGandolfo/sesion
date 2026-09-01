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


def _consultar_pendientes() -> list[dict]:
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    response = requests.get(config.PENDIENTES_URL, headers=headers, timeout=15)
    response.raise_for_status()
    body = response.json()
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in ("data", "pendientes", "sesiones"):
            valor = body.get(key)
            if isinstance(valor, list):
                return valor
    return []


def _extraer_args(
    item: dict,
) -> tuple[str, str, str, str, str | None, str, int] | None:
    sesion_id = item.get("sesionClinicaId") or item.get("id")
    audio_key = item.get("audioR2Key") or item.get("audio_r2_key")
    clave = item.get("claveCifrado") or item.get("clave_cifrado")
    iv = item.get("iv") or item.get("ivCifrado") or item.get("iv_cifrado")
    paciente_id = item.get("pacienteId") or item.get("paciente_id") or None
    orientacion = item.get("orientacionTeorica") or "cbt_mi"
    try:
        intento = int(item.get("intento") or 1)
    except (TypeError, ValueError):
        intento = 1
    if not sesion_id or not audio_key or not clave or not iv:
        return None
    return sesion_id, audio_key, clave, iv, paciente_id, orientacion, intento


def _procesar_pendientes(items: list[dict]) -> None:
    for item in items:
        if not _running:
            logger.info("Shutdown solicitado, no se toman mas sesiones de este ciclo")
            return
        args = _extraer_args(item)
        if not args:
            # Nunca loguear el item completo: trae claveCifrado e iv.
            # Solo el id y que campos faltan.
            sesion_id_log = item.get("sesionClinicaId") or item.get("id") or "?"
            faltan = [
                nombre
                for nombre, presente in (
                    ("sesionClinicaId", bool(item.get("sesionClinicaId") or item.get("id"))),
                    ("audioR2Key", bool(item.get("audioR2Key") or item.get("audio_r2_key"))),
                    ("claveCifrado", bool(item.get("claveCifrado") or item.get("clave_cifrado"))),
                    ("iv", bool(item.get("iv") or item.get("ivCifrado") or item.get("iv_cifrado"))),
                )
                if not presente
            ]
            logger.warning(
                f"Item ignorado por falta de campos: sesion={sesion_id_log} "
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
            pendientes = _consultar_pendientes()
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

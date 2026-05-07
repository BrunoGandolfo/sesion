"""
Orquesta el pipeline completo de procesamiento.
"""
import base64
import logging
import os
import requests
import config
import r2_client
import speech_analytics
from crypto import descifrar
from transcriber import transcribir, formatear_para_llm
from clinical_analyzer import analizar
from callback import enviar_resultado

logger = logging.getLogger(__name__)

ASR_MODELO_REPORTADO = "microsoft/VibeVoice-ASR"


def procesar_sesion(
    sesion_clinica_id: str,
    audio_r2_key: str,
    clave_cifrado: str,
    iv_cifrado: str,
    paciente_nombre: str = "",
    paciente_id: str | None = None,
) -> None:
    audio_path = None
    etiqueta = f"{sesion_clinica_id}{f' · {paciente_nombre}' if paciente_nombre else ''}"

    try:
        if not clave_cifrado or not iv_cifrado:
            raise RuntimeError("Falta clave_cifrado o iv_cifrado para descifrar el audio")

        # 1. Descargar
        logger.info(f"[{etiqueta}] Descargando de R2: {audio_r2_key}")
        if audio_r2_key == "dev-no-r2":
            raise RuntimeError("Audio en modo dev — no hay audio real")
        audio_cifrado, _ = r2_client.descargar_audio(audio_r2_key)
        logger.info(f"[{etiqueta}] Descargado: {len(audio_cifrado)} bytes")

        # 2. Descifrar
        logger.info(f"[{etiqueta}] Descifrando...")
        audio_bytes = descifrar(
            base64.b64encode(audio_cifrado).decode(),
            clave_cifrado,
            iv_cifrado,
        )

        # 3. Guardar temporal
        os.makedirs(config.AUDIO_TEMP_DIR, exist_ok=True)
        audio_path = os.path.join(config.AUDIO_TEMP_DIR, f"{sesion_clinica_id}.wav")
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        # 4. Hot words
        hot_words = _obtener_hot_words(paciente_id) if paciente_id else []

        # 5. Transcribir
        logger.info(f"[{etiqueta}] Transcribiendo...")
        transcripcion = transcribir(audio_path, hot_words)
        segments = transcripcion.get("segments", []) or []
        transcripcion_fmt = formatear_para_llm(transcripcion)
        logger.info(f"[{etiqueta}] {len(segments)} segmentos")

        # 6. Speech analytics (entre transcripción y LLM)
        logger.info(f"[{etiqueta}] Calculando speech analytics...")
        speech_metrics = speech_analytics.compute(segments)

        # 7. Nota clínica
        logger.info(f"[{etiqueta}] Generando nota...")
        resultado = analizar(transcripcion_fmt, sesiones_previas=None)

        # 8. Mergear speech analytics en datosEstructurados
        datos_estructurados = resultado.get("datosEstructurados") or {}
        datos_estructurados["speechAnalytics"] = speech_metrics

        # 9. Callback
        exito = enviar_resultado(
            sesion_clinica_id=sesion_clinica_id,
            estado="revision",
            transcripcion=transcripcion_fmt,
            nota=resultado.get("nota"),
            datos_estructurados=datos_estructurados,
            modelo_asr=ASR_MODELO_REPORTADO,
            modelo_llm=f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}",
        )
        if not exito:
            logger.error(f"[{etiqueta}] Callback fallo — audio NO se borra")
            return

        # 10. Borrar audio
        try:
            r2_client.borrar_audio(audio_r2_key)
            logger.info(f"[{etiqueta}] Audio borrado de R2")
        except Exception as e:
            logger.warning(f"[{etiqueta}] No se pudo borrar de R2: {e}")

        logger.info(f"[{etiqueta}] Completado")

    except Exception as e:
        logger.error(f"[{etiqueta}] Error: {e}", exc_info=True)
        try:
            enviar_resultado(
                sesion_clinica_id=sesion_clinica_id,
                estado="error",
                error=str(e),
                modelo_asr=ASR_MODELO_REPORTADO,
                modelo_llm=f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}",
            )
        except Exception as cb_err:
            logger.error(f"[{etiqueta}] Callback de error tambien fallo: {cb_err}")
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except OSError:
                pass


def _obtener_hot_words(paciente_id: str) -> list[str]:
    url = f"{config.HOT_WORDS_ENDPOINT}/{paciente_id}"
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            hw = data.get("data", [])
            logger.info(f"Hot words: {len(hw)} terminos")
            return hw
        logger.warning(f"Hot words: {response.status_code}")
        return []
    except Exception as e:
        logger.warning(f"Hot words error: {e}")
        return []

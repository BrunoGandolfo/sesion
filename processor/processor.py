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
from clinical_analyzer import (
    analizar,
    actualizar_contexto_clinico,
    generar_feedback_terapeuta,
)
from callback import enviar_resultado

logger = logging.getLogger(__name__)


def procesar_sesion(
    sesion_clinica_id: str,
    audio_r2_key: str,
    clave_cifrado: str,
    iv_cifrado: str,
    paciente_nombre: str = "",
    paciente_id: str | None = None,
    orientacion_teorica: str = "cbt_mi",
) -> None:
    audio_path = None
    # La etiqueta de log es solo el id de sesion. paciente_nombre se sigue
    # recibiendo por compatibilidad con el payload de /pendientes y el modo
    # manual, pero no se loguea: es PII y journald no esta cifrado.
    etiqueta = sesion_clinica_id
    del paciente_nombre

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

        # 7. Contexto clínico longitudinal (Golden Thread) — best-effort
        contexto_llm = (
            _obtener_contexto_clinico_llm(paciente_id) if paciente_id else None
        )
        if contexto_llm:
            logger.info(f"[{etiqueta}] Contexto longitudinal: {len(contexto_llm)} chars")

        # 8. Nota clínica
        logger.info(f"[{etiqueta}] Generando nota...")
        resultado = analizar(
            transcripcion_fmt,
            contexto_clinico=contexto_llm,
            speech_analytics=speech_metrics,
        )

        # 9. Mergear speech analytics en datosEstructurados
        datos_estructurados = resultado.get("datosEstructurados") or {}
        datos_estructurados["speechAnalytics"] = speech_metrics

        # 10. Feedback terapeuta (Llamada C) — best-effort, va en el callback
        logger.info(f"[{etiqueta}] Generando feedback terapeuta...")
        feedback_terapeuta = generar_feedback_terapeuta(
            transcripcion_fmt,
            speech_analytics=speech_metrics,
            orientacion=orientacion_teorica,
        )
        if feedback_terapeuta:
            datos_estructurados["feedbackTerapeuta"] = feedback_terapeuta

        # 11. Callback
        exito = enviar_resultado(
            sesion_clinica_id=sesion_clinica_id,
            estado="revision",
            transcripcion=transcripcion_fmt,
            nota=resultado.get("nota"),
            datos_estructurados=datos_estructurados,
            modelo_asr=config.ASR_MODEL_ID,
            modelo_llm=f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}",
        )
        if not exito:
            logger.error(f"[{etiqueta}] Callback fallo — audio NO se borra")
            return

        # 12. Llamada B: actualizar contexto clínico longitudinal (best-effort)
        nota_soap = resultado.get("nota")
        if paciente_id and nota_soap:
            _llamada_b_update_context(
                paciente_id,
                nota_soap,
                datos_estructurados,
                sesion_clinica_id,
                etiqueta,
            )

        # 13. El audio NO se borra acá: el material fuente vive hasta que la
        # profesional aprueba la nota (POST /aprobar borra R2 y nulea
        # audioR2Key) o elimina la sesion definitivamente (DELETE). Asi, el
        # descarte de una nota en revision deja la sesion reprocesable.
        logger.info(f"[{etiqueta}] Completado")

    except Exception as e:
        logger.error(f"[{etiqueta}] Error: {e}", exc_info=True)
        try:
            enviar_resultado(
                sesion_clinica_id=sesion_clinica_id,
                estado="error",
                error=str(e),
                modelo_asr=config.ASR_MODEL_ID,
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


def _contexto_clinico_url(paciente_id: str) -> str:
    return f"{config.APP_BASE_URL}/api/pacientes/{paciente_id}/contexto-clinico"


def _obtener_contexto_clinico_llm(paciente_id: str) -> str | None:
    """
    GET /api/pacientes/:id/contexto-clinico?format=llm — devuelve texto
    pre-formateado para inyectar al prompt SOAP. None si 404 o falla la red.
    """
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    try:
        r = requests.get(
            _contexto_clinico_url(paciente_id),
            params={"format": "llm"},
            headers=headers,
            timeout=15,
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        texto = r.text.strip()
        return texto or None
    except Exception as e:
        logger.warning(f"Contexto clinico (LLM) no disponible: {e}")
        return None


def _obtener_contexto_clinico_raw(paciente_id: str) -> dict:
    """
    GET /api/pacientes/:id/contexto-clinico — devuelve el JSON crudo para
    pasar al prompt update_context_v1. Retorna {} si 404 o falla la red.
    """
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    try:
        r = requests.get(
            _contexto_clinico_url(paciente_id), headers=headers, timeout=15
        )
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"Contexto clinico (raw) no disponible: {e}")
        return {}


def _patch_contexto_clinico(paciente_id: str, contexto_actualizado: dict) -> bool:
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    try:
        r = requests.patch(
            _contexto_clinico_url(paciente_id),
            json=contexto_actualizado,
            headers=headers,
            timeout=30,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"PATCH contexto-clinico fallo: {e}")
        return False


def _llamada_b_update_context(
    paciente_id: str,
    nota: dict,
    datos_estructurados: dict,
    sesion_clinica_id: str,
    etiqueta: str,
) -> None:
    """
    Best-effort: actualiza el PacienteContextoClinico tras callback exitoso.
    Nunca propaga excepciones — un fallo solo deja warning en log.
    """
    try:
        contexto_actual = _obtener_contexto_clinico_raw(paciente_id)
        actualizado = actualizar_contexto_clinico(
            contexto_actual,
            nota,
            datos_estructurados,
            sesion_clinica_id=sesion_clinica_id,
        )
        if _patch_contexto_clinico(paciente_id, actualizado):
            logger.info(f"[{etiqueta}] Contexto clinico actualizado")
        else:
            logger.warning(f"[{etiqueta}] PATCH contexto-clinico fallo")
    except Exception as e:
        logger.warning(f"[{etiqueta}] Llamada B (update_context) fallo: {e}")


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

"""
Orquesta el pipeline completo de una sesion:
R2 -> descifrado -> AssemblyAI -> speech analytics -> nota SOAP -> feedback
-> callback a la app.

La actualizacion del contexto longitudinal (Llamada B) NO vive aca: corre
sobre sesiones ya aprobadas, en contexto_worker.py.

Privacidad de logs: solo ids, conteos, codigos y status. Nunca clave, iv,
texto de transcripcion/nota ni datos del paciente.
"""
import base64
import logging

import requests

import asr_assemblyai
import config
import r2_client
import speech_analytics
from callback import CallbackResultado, enviar_resultado
from clinical_analyzer import analizar, generar_feedback_terapeuta
from crypto import descifrar
from errores import PipelineError
from transcripcion import formatear_para_llm

logger = logging.getLogger(__name__)


def procesar_sesion(
    sesion_clinica_id: str,
    audio_r2_key: str,
    clave_cifrado: str,
    iv_cifrado: str,
    paciente_id: str | None = None,
    orientacion_teorica: str = "cbt_mi",
    intento: int = 1,
) -> None:
    etiqueta = sesion_clinica_id
    # Valor provisional (modelo configurado) para los callbacks de error que
    # ocurren antes de transcribir; tras el ASR se reemplaza por el modelo
    # que AssemblyAI uso de verdad (principal o fallback).
    modelo_asr = f"assemblyai:{config.ASR_MODEL_ID}"
    modelo_llm = f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}"

    try:
        if not clave_cifrado or not iv_cifrado:
            raise PipelineError("audio_sin_clave", "Falta clave o iv para descifrar el audio")
        if audio_r2_key == "dev-no-r2":
            raise PipelineError("audio_dev", "Audio en modo dev, no hay audio real")

        # 1. Descargar
        logger.info(f"[{etiqueta}] Intento {intento}. Descargando de R2: {audio_r2_key}")
        try:
            audio_cifrado, _ = r2_client.descargar_audio(audio_r2_key)
        except Exception as e:
            logger.error(f"[{etiqueta}] R2 fallo ({type(e).__name__})")
            raise PipelineError("r2_error", "No se pudo descargar el audio de R2") from e
        logger.info(f"[{etiqueta}] Descargado: {len(audio_cifrado)} bytes")

        # 2. Descifrar (en memoria, sin escritura a disco)
        try:
            audio_bytes = descifrar(
                base64.b64encode(audio_cifrado).decode(),
                clave_cifrado,
                iv_cifrado,
            )
        except ValueError as e:
            # Los mensajes de crypto.descifrar son de forma (largos, tag), sin material de clave.
            logger.error(f"[{etiqueta}] Descifrado fallo: {str(e)[:120]}")
            raise PipelineError("descifrado_error", "No se pudo descifrar el audio") from e
        del audio_cifrado

        # 3. Transcribir + diarizar
        logger.info(f"[{etiqueta}] Transcribiendo ({len(audio_bytes)} bytes)...")
        transcripcion = asr_assemblyai.transcribir(audio_bytes, "audio/webm")
        del audio_bytes
        segments = transcripcion.get("segments") or []
        if not segments:
            raise PipelineError("asr_vacio", "La transcripcion no contiene segmentos")
        transcripcion_fmt = formatear_para_llm(transcripcion)
        # Modelo efectivamente usado por AssemblyAI, no el configurado.
        modelo_asr = f"assemblyai:{transcripcion['speech_model']}"
        logger.info(
            f"[{etiqueta}] {len(segments)} segmentos, "
            f"{transcripcion['duration_seconds']}s, roles={transcripcion['roles_origen']}, "
            f"modelo={modelo_asr}"
        )

        # 4. Speech analytics
        speech_metrics = speech_analytics.compute(segments)
        speech_metrics["rolesOrigen"] = transcripcion["roles_origen"]

        # 5. Contexto clinico longitudinal (Golden Thread) — best-effort
        contexto_llm = (
            _obtener_contexto_clinico_llm(paciente_id) if paciente_id else None
        )
        if contexto_llm:
            logger.info(f"[{etiqueta}] Contexto longitudinal: {len(contexto_llm)} chars")

        # 6. Nota clinica (Llamada A)
        logger.info(f"[{etiqueta}] Generando nota...")
        resultado, prompt_nota = analizar(
            transcripcion_fmt,
            contexto_clinico=contexto_llm,
            speech_analytics=speech_metrics,
        )

        # 7. datosEstructurados + speech analytics
        datos_estructurados = resultado.get("datosEstructurados") or {}
        datos_estructurados["speechAnalytics"] = speech_metrics

        # 8. Feedback terapeuta (Llamada C) — best-effort
        logger.info(f"[{etiqueta}] Generando feedback terapeuta...")
        feedback_terapeuta, prompt_feedback = generar_feedback_terapeuta(
            transcripcion_fmt,
            speech_analytics=speech_metrics,
            orientacion=orientacion_teorica,
        )
        if feedback_terapeuta:
            datos_estructurados["feedbackTerapeuta"] = feedback_terapeuta

        # 9. Metadatos del pipeline (trazabilidad)
        datos_estructurados["_pipeline"] = {
            "promptNota": prompt_nota,
            "promptFeedback": prompt_feedback,
            "modeloLLM": modelo_llm,
            "modeloASR": modelo_asr,
            "rolesOrigen": transcripcion["roles_origen"],
            "workerVersion": config.WORKER_VERSION,
            "asrId": transcripcion.get("asr_id"),
            "intento": intento,
        }

        # 10. Callback
        res = enviar_resultado(
            sesion_clinica_id=sesion_clinica_id,
            estado="revision",
            transcripcion=transcripcion_fmt,
            nota=resultado.get("nota"),
            datos_estructurados=datos_estructurados,
            modelo_asr=modelo_asr,
            modelo_llm=modelo_llm,
            prompt_version=f"{prompt_nota}+{prompt_feedback}",
        )
        if not _callback_terminal(res, etiqueta):
            # 5xx / sin respuesta: el lease de la app reintentara solo.
            logger.error(f"[{etiqueta}] Callback fallo (status={res.status}); el lease reintentara")
            return

        # El audio NO se borra aca: vive en R2 hasta que la profesional
        # aprueba la nota (crypto-shredding en /aprobar) o elimina la sesion.
        logger.info(f"[{etiqueta}] Completado")

    except PipelineError as e:
        logger.error(f"[{etiqueta}] {e.codigo}: {e.mensaje_publico}")
        _callback_error(
            sesion_clinica_id,
            f"{e.codigo}: {e.mensaje_publico}"[:200],
            modelo_asr,
            modelo_llm,
        )
    except Exception as e:
        # Sin str(e) de proveedores en el mensaje: solo tipo y texto truncado.
        logger.error(
            f"[{etiqueta}] error_interno {type(e).__name__}: {str(e)[:200]}",
            exc_info=True,
        )
        _callback_error(sesion_clinica_id, "error_interno", modelo_asr, modelo_llm)


def _callback_terminal(res: CallbackResultado, etiqueta: str) -> bool:
    """
    True si el callback termino el ciclo de la sesion (2xx, 409 o error de
    contrato 4xx). False si conviene dejar que el lease reintente.
    """
    if res.ok:
        return True
    if res.status == 409:
        logger.warning(f"[{etiqueta}] Sesion ya no esta en procesando; se descarta el resultado")
        return True
    if res.status is not None and 400 <= res.status < 500:
        logger.error(f"[{etiqueta}] Callback rechazado por contrato (HTTP {res.status}); no se reintenta")
        return True
    return False


def _callback_error(
    sesion_clinica_id: str, error: str, modelo_asr: str, modelo_llm: str
) -> None:
    try:
        res = enviar_resultado(
            sesion_clinica_id=sesion_clinica_id,
            estado="error",
            error=error,
            modelo_asr=modelo_asr,
            modelo_llm=modelo_llm,
        )
        if res.status == 409:
            logger.warning(f"[{sesion_clinica_id}] Sesion ya no esta en procesando (callback de error)")
    except Exception as e:
        logger.error(f"[{sesion_clinica_id}] Callback de error tambien fallo ({type(e).__name__})")


def _obtener_contexto_clinico_llm(paciente_id: str) -> str | None:
    """
    GET /api/pacientes/:id/contexto-clinico?format=llm — texto pre-formateado
    para inyectar al prompt SOAP. None si 404 o falla la red.
    """
    headers = {"Authorization": f"Bearer {config.PROCESSING_SECRET}"}
    try:
        r = requests.get(
            config.contexto_clinico_url(paciente_id),
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
        logger.warning(f"Contexto clinico (LLM) no disponible ({type(e).__name__})")
        return None

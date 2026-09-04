"""
Llamadas al LLM (Anthropic) con structured outputs: nota clinica SOAP
(Llamada A), actualizacion de contexto longitudinal (Llamada B) y feedback
de auto-supervision (Llamada C).

Cada funcion publica devuelve (resultado, nombre_de_prompt) para que el
pipeline reporte la version de prompt usada.
"""
import json
import logging
import os
from datetime import date

import anthropic

import config
from errores import PipelineError
from schemas_llm import (
    SCHEMA_CONTEXTO,
    SCHEMA_FEEDBACK_CBT_MI,
    SCHEMA_FEEDBACK_GESTALT,
    SCHEMA_NOTA,
    validar_rangos_nota,
)

logger = logging.getLogger(__name__)

PROMPTS = {
    "nota": "clinical_note_v3.1.md",
    "contexto": "update_context_v2.0.md",
    "feedback_cbt_mi": "therapist_feedback_v1.0.md",
    "feedback_gestalt": "therapist_feedback_gestalt_v1.0.md",
}

# Orientacion teorica -> (clave en PROMPTS, schema). Desconocida cae a cbt_mi.
_FEEDBACK_POR_ORIENTACION = {
    "cbt_mi": ("feedback_cbt_mi", SCHEMA_FEEDBACK_CBT_MI),
    "gestalt": ("feedback_gestalt", SCHEMA_FEEDBACK_GESTALT),
}


def _cargar_prompt(nombre: str) -> str:
    prompt_path = os.path.join(config.PROMPTS_DIR, nombre)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Prompt no encontrado: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


# Cliente Anthropic ─────────────────────────────────────────────────────────

_cliente_anthropic: anthropic.Anthropic | None = None


def _cliente() -> anthropic.Anthropic:
    global _cliente_anthropic
    if _cliente_anthropic is None:
        kwargs: dict = {
            "api_key": config.ANTHROPIC_API_KEY,
            "max_retries": 3,
            "timeout": config.LLM_TIMEOUT_SECONDS,
        }
        # Keys "identity-linked": la API exige anthropic-workspace-id en cada
        # pedido. El SDK lo aplica a todas las llamadas via default_headers.
        # Sin la env no se agrega nada: mismo constructor que antes.
        if config.ANTHROPIC_WORKSPACE_ID:
            kwargs["default_headers"] = {
                "anthropic-workspace-id": config.ANTHROPIC_WORKSPACE_ID
            }
        _cliente_anthropic = anthropic.Anthropic(**kwargs)
    return _cliente_anthropic


def mensaje_error_api(e: Exception) -> str:
    """
    Texto de validacion que devuelve la API en el cuerpo del error
    ({"error": {"type", "message"}}). Es diagnostico de la API, no contenido
    clinico; se trunca a 300 chars por si algun dia incluyera eco del input.
    Para excepciones que no son de la API (sin `body` ni `message`) devuelve
    "": es el mensaje acotado que usan processor y contexto_worker en vez de
    volcar trazas con cuerpos de respuesta.
    """
    mensaje = ""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            mensaje = str(err.get("message") or "")
            tipo = err.get("type")
            if tipo and mensaje:
                mensaje = f"{tipo}: {mensaje}"
        if not mensaje:
            mensaje = str(body.get("message") or "")
    if not mensaje:
        mensaje = str(getattr(e, "message", "") or "")
    return mensaje[:300]


def _llamar_anthropic(system_prompt: str, user_content: str, schema: dict) -> dict:
    """
    Una llamada a la Messages API con structured output (json_schema).
    El system prompt lleva cache_control: es identico entre sesiones y
    representa la mayor parte del input.
    """
    output_config: dict = {"format": {"type": "json_schema", "schema": schema}}
    # `effort` vive dentro de output_config en la API actual. Los niveles
    # aceptados dependen del modelo; vacio = no enviar y usar el default.
    if config.LLM_EFFORT:
        output_config["effort"] = config.LLM_EFFORT

    logger.info(f"Llamando Anthropic ({config.LLM_MODEL_ID}, effort={config.LLM_EFFORT or 'default'})...")
    try:
        response = _cliente().messages.create(
            model=config.LLM_MODEL_ID,
            max_tokens=config.LLM_MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_content}],
            output_config=output_config,
        )
    except anthropic.APITimeoutError as e:
        logger.error(f"Anthropic timeout tras {config.LLM_TIMEOUT_SECONDS}s")
        raise PipelineError("llm_timeout", "Anthropic no respondio a tiempo") from e
    except anthropic.APIStatusError as e:
        logger.error(
            f"Anthropic HTTP {e.status_code} (request_id={getattr(e, 'request_id', None)}): "
            f"{mensaje_error_api(e) or 'sin mensaje en el cuerpo'}"
        )
        raise PipelineError("llm_error", f"Anthropic respondio {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        logger.error(f"Anthropic sin conexion ({type(e).__name__})")
        raise PipelineError("llm_error", "Anthropic no responde") from e

    usage = response.usage
    logger.info(
        f"Anthropic OK (request_id={getattr(response, '_request_id', None)}): "
        f"input={usage.input_tokens} output={usage.output_tokens} "
        f"cache_read={getattr(usage, 'cache_read_input_tokens', None)} "
        f"cache_write={getattr(usage, 'cache_creation_input_tokens', None)} "
        f"stop={response.stop_reason}"
    )

    if response.stop_reason == "max_tokens":
        raise PipelineError(
            "llm_truncado", f"Respuesta truncada en {config.LLM_MAX_TOKENS} tokens"
        )
    if response.stop_reason == "refusal":
        raise PipelineError("llm_rechazo", "El modelo rechazo la solicitud")

    texto = next((b.text for b in response.content if b.type == "text"), None)
    if texto is None:
        raise PipelineError("llm_sin_texto", "La respuesta no contiene bloque de texto")

    try:
        return json.loads(texto)
    except json.JSONDecodeError as e:
        # No volcar el texto crudo: puede contener la nota clinica entera.
        # Solo metadatos de forma para diagnosticar el fallo de parseo.
        stripped = texto.strip()
        logger.error(
            f"JSON invalido del LLM: linea {e.lineno} col {e.colno} "
            f"(len={len(stripped)} chars, "
            f"empieza_con_llave={stripped.startswith('{')}, "
            f"termina_con_llave={stripped.endswith('}')})"
        )
        raise PipelineError("llm_json_invalido", "El LLM no devolvio JSON valido") from e


def _llamar_llm(system_prompt: str, user_content: str, schema: dict) -> dict:
    if config.LLM_BACKEND == "anthropic":
        return _llamar_anthropic(system_prompt, user_content, schema)
    raise ValueError(f"Backend no soportado: {config.LLM_BACKEND}")


# Llamada A — nota SOAP ─────────────────────────────────────────────────────

def analizar(
    transcripcion_formateada: str,
    contexto_clinico: str | None = None,
    speech_analytics: dict | None = None,
) -> tuple[dict, str]:
    """
    Genera la nota SOAP usando el prompt de PROMPTS["nota"]. Arma el user
    message con los tags XML que el prompt espera: <transcripcion>,
    <speech_analytics>, <contexto_previo>. Devuelve (resultado, nombre_prompt).
    """
    nombre_prompt = PROMPTS["nota"]
    system_prompt = _cargar_prompt(nombre_prompt)

    bloques = [
        "<transcripcion>\n"
        f"{transcripcion_formateada}\n"
        "</transcripcion>"
    ]
    if speech_analytics:
        bloques.append(
            "<speech_analytics>\n"
            f"{json.dumps(speech_analytics, ensure_ascii=False, indent=2)}\n"
            "</speech_analytics>"
        )
    if contexto_clinico and contexto_clinico.strip():
        bloques.append(
            "<contexto_previo>\n"
            f"{contexto_clinico.strip()}\n"
            "</contexto_previo>"
        )
    user_content = "\n\n".join(bloques)

    resultado = _llamar_llm(system_prompt, user_content, SCHEMA_NOTA)
    try:
        validar_rangos_nota(resultado)
    except ValueError as e:
        raise PipelineError("llm_rango_invalido", str(e)) from e

    logger.info(f"Nota clinica generada ({nombre_prompt})")
    return resultado, nombre_prompt


# Llamada B — contexto longitudinal ─────────────────────────────────────────

def actualizar_contexto_clinico(
    contexto_previo: dict,
    nota: dict,
    datos_estructurados: dict,
    sesion_clinica_id: str,
    fecha: str | None = None,
    numero_sesion: int = 0,
) -> tuple[dict, str]:
    """
    Actualiza el PacienteContextoClinico tras una nota SOAP aprobada, con el
    prompt de PROMPTS["contexto"] (bloques <sesion_actual>, <contexto_previo>,
    <nota_soap_aprobada>). Devuelve (contexto_actualizado, nombre_prompt).
    """
    nombre_prompt = PROMPTS["contexto"]
    system_prompt = _cargar_prompt(nombre_prompt)
    sesion_actual = {
        "sesionClinicaId": sesion_clinica_id,
        "fecha": fecha or date.today().isoformat(),
        "numeroSesion": numero_sesion,
    }
    nota_soap = {"nota": nota, "datosEstructurados": datos_estructurados}
    user_content = (
        "<sesion_actual>\n"
        f"{json.dumps(sesion_actual, ensure_ascii=False, indent=2)}\n"
        "</sesion_actual>\n\n"
        "<contexto_previo>\n"
        f"{json.dumps(contexto_previo or {}, ensure_ascii=False, indent=2)}\n"
        "</contexto_previo>\n\n"
        "<nota_soap_aprobada>\n"
        f"{json.dumps(nota_soap, ensure_ascii=False, indent=2)}\n"
        "</nota_soap_aprobada>"
    )

    actualizado = _llamar_llm(system_prompt, user_content, SCHEMA_CONTEXTO)
    logger.info(f"Contexto clinico actualizado ({nombre_prompt})")
    return actualizado, nombre_prompt


# Llamada C — feedback terapeuta ────────────────────────────────────────────

def generar_feedback_terapeuta(
    transcripcion_formateada: str,
    speech_analytics: dict | None = None,
    orientacion: str = "cbt_mi",
) -> tuple[dict | None, str]:
    """
    Reporte de auto-supervision segun orientacion teorica (MITI/CTS-R para
    cbt_mi, GTFS para gestalt). Orientacion desconocida cae a cbt_mi.
    Best-effort: si falla el LLM devuelve (None, nombre_prompt) y deja
    warning en log. Se embebe en datosEstructurados.feedbackTerapeuta.
    """
    clave, schema = _FEEDBACK_POR_ORIENTACION.get(
        orientacion, _FEEDBACK_POR_ORIENTACION["cbt_mi"]
    )
    nombre_prompt = PROMPTS[clave]
    logger.info(f"Feedback terapeuta: orientacion={orientacion}, prompt={nombre_prompt}")
    try:
        system_prompt = _cargar_prompt(nombre_prompt)
        bloques = [
            "<transcripcion>\n"
            f"{transcripcion_formateada}\n"
            "</transcripcion>"
        ]
        if speech_analytics:
            bloques.append(
                "<speech_analytics>\n"
                f"{json.dumps(speech_analytics, ensure_ascii=False, indent=2)}\n"
                "</speech_analytics>"
            )
        user_content = "\n\n".join(bloques)

        feedback = _llamar_llm(system_prompt, user_content, schema)
        logger.info(f"Feedback terapeuta generado ({nombre_prompt})")
        return feedback, nombre_prompt
    except PipelineError as e:
        logger.warning(f"Feedback terapeuta fallo: {e.codigo}: {e.mensaje_publico}")
        return None, nombre_prompt
    except Exception as e:
        logger.warning(f"Feedback terapeuta fallo: {type(e).__name__}: {str(e)[:200]}")
        return None, nombre_prompt

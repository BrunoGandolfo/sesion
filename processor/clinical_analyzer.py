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
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import anthropic

import config
from errores import PipelineError
from schemas_llm import (
    SCHEMA_CONTEXTO,
    SCHEMA_FEEDBACK_CBT_MI,
    SCHEMA_FEEDBACK_GESTALT,
    SCHEMA_NOTA,
    sanear_datos_nota,
    sanear_feedback,
    validar_estructura_contexto,
    validar_estructura_feedback_cbt_mi,
    validar_estructura_feedback_gestalt,
    validar_estructura_nota,
)

logger = logging.getLogger(__name__)

PROMPTS = {
    "nota": "clinical_note_v3.1.1.md",
    "contexto": "update_context_v2.0.md",
    "feedback_cbt_mi": "therapist_feedback_v1.1.md",
    "feedback_gestalt": "therapist_feedback_gestalt_v1.1.md",
}

# Orientacion teorica -> (clave en PROMPTS, schema, validador estructural).
# Desconocida cae a cbt_mi.
_FEEDBACK_POR_ORIENTACION = {
    "cbt_mi": ("feedback_cbt_mi", SCHEMA_FEEDBACK_CBT_MI, validar_estructura_feedback_cbt_mi),
    "gestalt": ("feedback_gestalt", SCHEMA_FEEDBACK_GESTALT, validar_estructura_feedback_gestalt),
}

# Una sola segunda pasada. Si el modelo no acierta la forma dos veces
# seguidas con el error citado, el problema no lo arregla insistir.
MAX_REINTENTOS_ESTRUCTURA = 1


@dataclass
class DiagnosticoLLM:
    """Lo que el pipeline reporta de la llamada, mas alla del resultado."""

    reintentos: int = 0
    advertencias: list[str] = field(default_factory=list)


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


def _llamar_anthropic(
    system_prompt: str, user_content: str, schema: dict, max_tokens: int
) -> dict:
    """
    Una llamada a la Messages API con structured output (json_schema).
    El system prompt lleva cache_control: es identico entre sesiones y
    representa la mayor parte del input.

    `max_tokens` es por llamada: la nota y el contexto usan
    config.LLM_MAX_TOKENS y el feedback config.LLM_MAX_TOKENS_FEEDBACK, que es
    mas alto porque el reporte gestalt no entraba en el techo comun.
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
            max_tokens=max_tokens,
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
            "llm_truncado", f"Respuesta truncada en {max_tokens} tokens"
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


def _llamar_llm(
    system_prompt: str, user_content: str, schema: dict, max_tokens: int
) -> dict:
    if config.LLM_BACKEND == "anthropic":
        return _llamar_anthropic(system_prompt, user_content, schema, max_tokens)
    raise ValueError(f"Backend no soportado: {config.LLM_BACKEND}")


# Reintento por forma ───────────────────────────────────────────────────────

def _bloque_correccion(motivo: str) -> str:
    """
    Mensaje de la segunda pasada. Le cita al modelo el error de validacion y
    le pide el JSON completo de nuevo.

    No se le devuelve su propia salida anterior: contendria la nota clinica
    entera y duplicaria material del paciente en el input. Con el nombre del
    campo y el tipo esperado alcanza, y es lo unico que los validadores
    producen (ver schemas_llm.validar_estructura_*).
    """
    return (
        "<correccion>\n"
        "Tu respuesta anterior no se pudo usar porque no cumple el schema.\n"
        f"Error de validacion: {motivo}\n"
        "Devolve de nuevo el JSON COMPLETO, corrigiendo exactamente ese punto y "
        "respetando el resto del schema. Sin texto fuera del JSON.\n"
        "</correccion>"
    )


def _llamar_validando(
    system_prompt: str,
    user_content: str,
    schema: dict,
    validar: Callable[[object], None] | None = None,
) -> tuple[dict, int]:
    """
    Llama al LLM y verifica la estructura del resultado.

    Ante un fallo de FORMA —JSON no parseable, seccion SOAP faltante, enum
    invalido— repite la llamada una sola vez citandole el error. Los fallos de
    transporte (timeout, HTTP, conexion) no se reintentan aca: de eso ya se
    ocupa `max_retries` del SDK, y repetir una llamada de 8k tokens porque la
    red se cayo no arregla nada.

    Devuelve (resultado, reintentos), con reintentos en 0 o 1.
    """
    motivo: str | None = None

    for intento in range(MAX_REINTENTOS_ESTRUCTURA + 1):
        contenido = (
            user_content
            if motivo is None
            else f"{user_content}\n\n{_bloque_correccion(motivo)}"
        )

        # Los dos try van separados a proposito: `_llamar_llm` tambien lanza
        # ValueError (backend no soportado), y eso es un error de
        # configuracion, no una salida mal formada del modelo.
        try:
            resultado = _llamar_llm(system_prompt, contenido, schema)
        except PipelineError as e:
            if e.codigo != "llm_json_invalido" or intento == MAX_REINTENTOS_ESTRUCTURA:
                raise
            motivo = "la respuesta anterior no era JSON parseable"
        else:
            if validar is None:
                return resultado, intento
            try:
                validar(resultado)
            except ValueError as e:
                if intento == MAX_REINTENTOS_ESTRUCTURA:
                    raise PipelineError("llm_estructura_invalida", str(e)) from e
                motivo = str(e)
            else:
                return resultado, intento

        logger.warning(f"Salida del LLM invalida ({motivo}); se pide correccion (1 intento)")

    # Inalcanzable: el bucle sale por return o por raise.
    raise PipelineError("llm_estructura_invalida", "No se obtuvo una salida valida")


# Llamada A — nota SOAP ─────────────────────────────────────────────────────

def analizar(
    transcripcion_formateada: str,
    contexto_clinico: str | None = None,
    speech_analytics: dict | None = None,
) -> tuple[dict, str, DiagnosticoLLM]:
    """
    Genera la nota SOAP usando el prompt de PROMPTS["nota"]. Arma el user
    message con los tags XML que el prompt espera: <transcripcion>,
    <speech_analytics>, <contexto_previo>.

    Devuelve (resultado, nombre_prompt, diagnostico). Falla solo por forma:
    las escalas de valoracion fuera de rango se anulan y quedan como
    advertencia en el diagnostico.
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

    resultado, reintentos = _llamar_validando(
        system_prompt, user_content, SCHEMA_NOTA, validar_estructura_nota
    )
    advertencias = sanear_datos_nota(resultado)
    for advertencia in advertencias:
        logger.warning(f"Nota clinica: {advertencia}")

    logger.info(f"Nota clinica generada ({nombre_prompt}, reintentos={reintentos})")
    return resultado, nombre_prompt, DiagnosticoLLM(reintentos, advertencias)


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

    actualizado, reintentos = _llamar_validando(
        system_prompt, user_content, SCHEMA_CONTEXTO, validar_estructura_contexto
    )
    logger.info(f"Contexto clinico actualizado ({nombre_prompt}, reintentos={reintentos})")
    return actualizado, nombre_prompt


# Llamada C — feedback terapeuta ────────────────────────────────────────────

def generar_feedback_terapeuta(
    transcripcion_formateada: str,
    speech_analytics: dict | None = None,
    orientacion: str = "cbt_mi",
) -> tuple[dict | None, str, DiagnosticoLLM]:
    """
    Reporte de auto-supervision segun orientacion teorica (MITI/CTS-R para
    cbt_mi, GTFS para gestalt). Orientacion desconocida cae a cbt_mi.

    Best-effort de punta a punta: si falla el LLM devuelve
    (None, nombre_prompt, diagnostico) con el motivo como advertencia. La nota
    clinica ya esta generada a esta altura y una sesion no se pierde porque el
    reporte de auto-supervision no salio.
    """
    clave, schema, validar = _FEEDBACK_POR_ORIENTACION.get(
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

        feedback, reintentos = _llamar_validando(
            system_prompt, user_content, schema, validar
        )
        advertencias = sanear_feedback(feedback, orientacion)
        for advertencia in advertencias:
            logger.warning(f"Feedback terapeuta: {advertencia}")

        logger.info(f"Feedback terapeuta generado ({nombre_prompt}, reintentos={reintentos})")
        return feedback, nombre_prompt, DiagnosticoLLM(reintentos, advertencias)
    except PipelineError as e:
        logger.warning(f"Feedback terapeuta fallo: {e.codigo}: {e.mensaje_publico}")
        return None, nombre_prompt, DiagnosticoLLM(
            advertencias=[f"feedbackTerapeuta no disponible: {e.codigo}"]
        )
    except Exception as e:
        logger.warning(f"Feedback terapeuta fallo: {type(e).__name__}: {str(e)[:200]}")
        return None, nombre_prompt, DiagnosticoLLM(
            advertencias=[f"feedbackTerapeuta no disponible: {type(e).__name__}"]
        )

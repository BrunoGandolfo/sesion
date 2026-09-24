"""
Configuración del servicio de procesamiento de sesiones clínicas.

Ola 3: ASR en AssemblyAI, LLM en Anthropic, worker hosteado en Railway.
Todo se lee de variables de entorno; ver .env.example.
"""
import os
from urllib.parse import urlsplit

# App Sesión (Vercel) ───────────────────────────────────────────────────────
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3001")
PROCESSING_SECRET = os.getenv("PROCESSING_SECRET", "")

# Cloudflare R2 (audio del telefono, tal cual) ─────────────────────────────
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "sesion-audio")

# ASR — AssemblyAI ──────────────────────────────────────────────────────────
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
# Modelo principal y fallback. Se envian como lista ordenada `speech_models`
# (el singular `speech_model` esta deprecado). Identificadores vigentes:
#   https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model
#   https://www.assemblyai.com/docs/pre-recorded-audio/universal-3-5-pro
# ASR_MODEL_ID se reporta en el checkpoint como modeloAsr.
ASR_MODEL_ID = os.getenv("ASR_MODEL_ID", "universal-3-5-pro")
ASR_MODEL_FALLBACK = os.getenv("ASR_MODEL_FALLBACK", "universal-2")
# Prompt de contexto (`prompt`, solo Universal-3.5 Pro; hasta 1.500 palabras,
# la doc recomienda 5-15 palabras para describir el escenario en lenguaje llano):
#   https://www.assemblyai.com/docs/pre-recorded-audio/universal-3-5-pro/prompting
# Vacio = no enviar el parametro.
ASR_PROMPT_ESCENARIO = os.getenv(
    "ASR_PROMPT_ESCENARIO",
    "Sesión de psicoterapia entre una psicóloga y un paciente, "
    "en español rioplatense, en consultorio.",
)
ASR_POLL_SECONDS = int(os.getenv("ASR_POLL_SECONDS", "10"))
ASR_TIMEOUT_SECONDS = int(os.getenv("ASR_TIMEOUT_SECONDS", "1800"))

# LLM — Anthropic ───────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
# Las API keys "identity-linked" exigen la cabecera anthropic-workspace-id en
# cada pedido (sin ella la API responde 400). Opcional: vacío = no se manda
# ninguna cabecera y el cliente se construye exactamente como antes.
ANTHROPIC_WORKSPACE_ID = os.getenv("ANTHROPIC_WORKSPACE_ID", "").strip()
LLM_MODEL_ID = os.getenv("LLM_MODEL_ID", "claude-sonnet-5")
# Nivel de esfuerzo (low|medium|high|xhigh|max). Vacío = no enviar el parámetro.
LLM_EFFORT = os.getenv("LLM_EFFORT", "medium")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "8192"))

# Techo propio para la Llamada A (nota clinica SOAP).
#
# 2026-09-19: una sesion normal de 21 minutos (transcripcion de 11.856
# caracteres) termino "fallida" con codigo llm_truncado en el paso "nota", y la
# profesional se quedo sin nota. Es el mismo sintoma que tuvo el feedback el
# 7-sep y se arregla igual: lo que sube es el techo. Los prompts no se tocan y
# la estructura de la nota tampoco.
#
# POR QUE 8192 NO ALCANZA PARA UNA NOTA QUE PARECE CORTA
#
# Porque de esos 8192 la nota nunca tuvo 8192: los tokens de razonamiento
# cuentan DENTRO de max_tokens. La documentacion de Anthropic lo dice con
# todas las letras:
#
#   "max_tokens is a hard cap on total output for the request, thinking and
#    response text combined. Claude never generates past it."
#   "Because thinking counts toward max_tokens, set it high enough to leave
#    room for both the reasoning and the answer. A max_tokens sized for a
#    response with no thinking is often too small once Claude starts thinking
#    on hard requests."
#   https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
#
# Y en claude-sonnet-5 el pensamiento esta activo aunque no se mande el
# parametro `thinking`: LLM_EFFORT solo gradua cuanto se piensa (el default de
# la API es "high"; aca vamos en "medium"). Asi que el techo se reparte entre
# razonar y escribir, y una nota de dos carillas se corta. La misma pagina da
# los dos remedios: subir max_tokens o bajar el effort. Subimos el techo:
# bajar el effort es cambiar la calidad del razonamiento clinico, y eso no se
# decide por un problema de tamano de respuesta.
#
# 16384 es el mismo numero y el mismo criterio que el feedback (ver abajo).
LLM_MAX_TOKENS_NOTA = int(os.getenv("LLM_MAX_TOKENS_NOTA", "16384"))

# Techo de la SEGUNDA pasada cuando la primera volvio truncada. Hasta ahora el
# reintento por llm_truncado repetia el pedido con el MISMO techo, asi que casi
# no podia terminar distinto: dos truncados seguidos y la sesion quedaba
# fallida. Ahora la segunda pasada duplica el techo, hasta este tope.
#
# El limite real de este numero es el tiempo, no el SDK. El SDK tiene un
# chequeo (`_calculate_nonstreaming_timeout`: exige streaming si
# 3600 * max_tokens / 128000 pasa de 600 s, o sea max_tokens > 21333), pero
# SOLO corre si el cliente usa el timeout por defecto del SDK
# (resources/messages/messages.py, `self._client.timeout == DEFAULT_TIMEOUT`,
# verificado en anthropic 1.8.0). Este worker construye el cliente con
# LLM_TIMEOUT_SECONDS, asi que ese chequeo no corre nunca.
#
# Lo que manda es que, sin streaming, la respuesta llega entera al final: el
# pedido tiene que terminar de generar dentro de LLM_TIMEOUT_SECONDS. 20480
# tokens a 35 tok/s son ~585 s, y por eso el timeout es 600 (hay un test que
# ata los dos numeros). Subir este techo sin subir el timeout, o sin pasar a
# streaming, es fabricar timeouts. `uso.llamadas[].ms` dice cuanto tarda de
# verdad cada llamada.
LLM_MAX_TOKENS_REINTENTO = int(os.getenv("LLM_MAX_TOKENS_REINTENTO", "20480"))

# Techo propio para la Llamada C (feedback de auto-supervision).
#
# 2026-09-07: el fin de semana, 5 de 8 sesiones terminaron con
# "llm_truncado: Respuesta truncada en 8192 tokens" y quedaron sin "Para vos".
# El feedback gestalt (GTFS, therapist_feedback_gestalt_v1.1.md) es el mas
# largo de los tres tipos de llamada y no entra en 8192. El prompt no se toca:
# cuanto dura el feedback lo decide Mariana, asi que lo que sube es el techo.
#
# 16384 es holgado: claude-sonnet-5 admite hasta 128K tokens de salida. Sin
# streaming, lo que acota el techo es LLM_TIMEOUT_SECONDS (ver arriba).
LLM_MAX_TOKENS_FEEDBACK = int(os.getenv("LLM_MAX_TOKENS_FEEDBACK", "16384"))

# Espera HTTP de cada pedido a Anthropic. Sin streaming es, en la practica, la
# duracion total de la generacion: tiene que cubrir la segunda pasada de
# LLM_MAX_TOKENS_REINTENTO a una velocidad de salida conservadora (35 tok/s;
# no esta documentada, HIPOTESIS a confirmar con uso.llamadas[].ms).
LLM_TIMEOUT_SECONDS = int(os.getenv("LLM_TIMEOUT_SECONDS", "600"))
# Reintentos del SDK ante 429, 5xx, conexion y TIMEOUT. Con 600 s por pedido,
# los 3 de antes daban 4 x 600 s = 40 min de cola bloqueada en el peor caso
# (el worker procesa en serie). Con 1, 20 min. Los fallos que igual quedan
# vuelven como transitorios y la app los reencola con backoff.
LLM_MAX_RETRIES = 1

# Worker ────────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
PROMPTS_DIR = os.getenv("PROMPTS_DIR", os.path.join(os.path.dirname(__file__), "prompts"))
# Viaja como X-Worker-Version en cada latido y como `worker` en cada `uso`:
# es lo que dice que codigo produjo una nota. Orden: la variable explicita (si
# alguien la carga, manda), el commit que desplego Railway, y "local". Railway
# inyecta RAILWAY_GIT_COMMIT_SHA solo en los deploys disparados desde GitHub
# (docs.railway.com/reference/variables); un `railway up` a mano no la trae.
WORKER_VERSION = (
    os.getenv("WORKER_VERSION", "").strip()
    or os.getenv("RAILWAY_GIT_COMMIT_SHA", "").strip()[:7]
    or "local"
)
# Railway inyecta RAILWAY_ENVIRONMENT_ID siempre (build y deploy). Sin ella,
# el worker corre en una maquina de desarrollo.
EN_RAILWAY = bool(os.getenv("RAILWAY_ENVIRONMENT_ID", "").strip())

# Endpoints de la app ───────────────────────────────────────────────────────
PENDIENTES_URL = f"{APP_BASE_URL}/api/sesion-clinica/pendientes"


def hilo_url(paciente_id: str) -> str:
    return f"{APP_BASE_URL}/api/pacientes/{paciente_id}/hilo"


def r2_configurado() -> bool:
    return all([R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME])


_HOSTS_LOCALES = frozenset({"localhost", "127.0.0.1", "::1"})


def _app_base_url_valida(url: str, en_railway: bool) -> bool:
    """
    https:// con host, siempre. La unica excepcion es http:// contra la propia
    maquina, y solo fuera de Railway: en Railway el default de localhost
    significa que APP_BASE_URL no se cargo, y el worker se quedaria para
    siempre logueando "Error consultando pendientes (ConnectionError)".
    """
    partes = urlsplit(url)
    if partes.scheme == "https" and partes.hostname:
        return True
    return partes.scheme == "http" and partes.hostname in _HOSTS_LOCALES and not en_railway


def validar_config() -> None:
    errores = []
    if not _app_base_url_valida(APP_BASE_URL, EN_RAILWAY):
        errores.append("APP_BASE_URL tiene que ser https:// (http solo contra localhost fuera de Railway)")
    if not PROCESSING_SECRET:
        errores.append("PROCESSING_SECRET no configurado")
    if not ANTHROPIC_API_KEY:
        errores.append("ANTHROPIC_API_KEY no configurado")
    if not ASSEMBLYAI_API_KEY:
        errores.append("ASSEMBLYAI_API_KEY no configurado")
    if not r2_configurado():
        errores.append(
            "R2 incompleto (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)"
        )
    if errores:
        raise RuntimeError(f"Configuración inválida: {', '.join(errores)}")

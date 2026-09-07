"""
Configuración del servicio de procesamiento de sesiones clínicas.

Ola 3: ASR en AssemblyAI, LLM en Anthropic, worker hosteado en Railway.
Todo se lee de variables de entorno; ver .env.example.
"""
import os

# App Sesión (Vercel) ───────────────────────────────────────────────────────
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3001")
PROCESSING_SECRET = os.getenv("PROCESSING_SECRET", "")

# Cloudflare R2 (audio cifrado) ─────────────────────────────────────────────
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
# ASR_MODEL_ID se reporta en el callback como modeloASR.
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
LLM_BACKEND = os.getenv("LLM_BACKEND", "anthropic")
LLM_MODEL_ID = os.getenv("LLM_MODEL_ID", "claude-sonnet-5")
# Nivel de esfuerzo (low|medium|high|xhigh|max). Vacío = no enviar el parámetro.
LLM_EFFORT = os.getenv("LLM_EFFORT", "medium")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "8192"))
# Techo propio para la Llamada C (feedback de auto-supervision).
#
# 2026-09-07: el fin de semana, 5 de 8 sesiones terminaron con
# "llm_truncado: Respuesta truncada en 8192 tokens" y quedaron sin "Para vos".
# El feedback gestalt (GTFS, therapist_feedback_gestalt_v1.1.md) es el mas
# largo de los tres tipos de llamada y no entra en 8192. El prompt no se toca:
# cuanto dura el feedback lo decide Mariana, asi que lo que sube es el techo.
#
# 16384 es holgado y sigue siendo seguro sin streaming: claude-sonnet-5 admite
# hasta 128K tokens de salida, y la guia del SDK recomienda ~16000 como maximo
# para peticiones NO streaming (por encima de eso hay que usar .stream() para
# no chocar con el timeout HTTP del cliente). Este worker no usa streaming.
LLM_MAX_TOKENS_FEEDBACK = int(os.getenv("LLM_MAX_TOKENS_FEEDBACK", "16384"))
LLM_TIMEOUT_SECONDS = int(os.getenv("LLM_TIMEOUT_SECONDS", "300"))

# Worker ────────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
PROMPTS_DIR = os.getenv("PROMPTS_DIR", os.path.join(os.path.dirname(__file__), "prompts"))
WORKER_VERSION = os.getenv("WORKER_VERSION", "ola3")

# Endpoints de la app ───────────────────────────────────────────────────────
PENDIENTES_URL = f"{APP_BASE_URL}/api/sesion-clinica/pendientes"
CALLBACK_URL = f"{APP_BASE_URL}/api/sesion-clinica/callback"
APROBADAS_URL = f"{APP_BASE_URL}/api/sesion-clinica/aprobadas-sin-contexto"


def contexto_clinico_url(paciente_id: str) -> str:
    return f"{APP_BASE_URL}/api/pacientes/{paciente_id}/contexto-clinico"


def r2_configurado() -> bool:
    return all([R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME])


def validar_config() -> None:
    errores = []
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

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
# Confirmar el identificador vigente de Universal-3.5 Pro en docs.assemblyai.com
# antes del primer deploy; se reporta en el callback como modeloASR.
ASR_MODEL_ID = os.getenv("ASR_MODEL_ID", "universal-3-pro")
ASR_POLL_SECONDS = int(os.getenv("ASR_POLL_SECONDS", "10"))
ASR_TIMEOUT_SECONDS = int(os.getenv("ASR_TIMEOUT_SECONDS", "1800"))

# LLM — Anthropic ───────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_BACKEND = os.getenv("LLM_BACKEND", "anthropic")
LLM_MODEL_ID = os.getenv("LLM_MODEL_ID", "claude-sonnet-5")
# Nivel de esfuerzo (low|medium|high|xhigh|max). Vacío = no enviar el parámetro.
LLM_EFFORT = os.getenv("LLM_EFFORT", "medium")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "8192"))
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

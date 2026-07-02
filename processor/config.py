"""
Configuración del servicio de procesamiento de sesiones clínicas.
"""
import os

# App Sesión (Vercel) ───────────────────────────────────────────────────────
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3001")
PROCESSING_SECRET = os.getenv("PROCESSING_SECRET", "")

# Cloudflare R2 ─────────────────────────────────────────────────────────────
# Preferido: R2_ENDPOINT directo. Fallback legacy: derivarlo desde R2_ACCOUNT_ID.
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "sesion-audio")
R2_ENDPOINT = os.getenv("R2_ENDPOINT") or (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else ""
)

# ASR — WhisperX (Whisper large-v3 + pyannote) corre como servicio HTTP en
# Atlas. ASR_MODEL_ID se reporta en el callback (campo modelo_asr).
ASR_MODEL_ID = os.getenv("ASR_MODEL_ID", "whisperx-large-v3")
ASR_URL = os.getenv("ASR_URL", "http://100.71.155.25:8090/transcribe")
ASR_HEALTH_URL = os.getenv("ASR_HEALTH_URL", "http://100.71.155.25:8090/health")
ASR_TIMEOUT_SECONDS = int(os.getenv("ASR_TIMEOUT_SECONDS", "600"))

# LLM (nota clínica SOAP) ───────────────────────────────────────────────────
LLM_MODEL_ID = os.getenv("LLM_MODEL_ID", "qwen3.6:27b")
LLM_BACKEND = os.getenv("LLM_BACKEND", "ollama")
LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "65536"))
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://100.71.155.25:11434")
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8091")

# Worker ────────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
AUDIO_TEMP_DIR = os.getenv("AUDIO_TEMP_DIR", "/tmp/sesion-audio")
PROMPTS_DIR = os.getenv("PROMPTS_DIR", os.path.join(os.path.dirname(__file__), "prompts"))

# Endpoints de la app ───────────────────────────────────────────────────────
HOT_WORDS_ENDPOINT = f"{APP_BASE_URL}/api/hot-words/paciente"
PENDIENTES_URL = f"{APP_BASE_URL}/api/sesion-clinica/pendientes"

def r2_configurado() -> bool:
    return all([R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME])

def validar_config():
    errores = []
    if not PROCESSING_SECRET:
        errores.append("PROCESSING_SECRET no configurado")
    if errores:
        raise RuntimeError(f"Configuración inválida: {', '.join(errores)}")

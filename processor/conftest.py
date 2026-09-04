"""
Configuracion de pytest para processor/.

Este archivo en la raiz del paquete hace que pytest agregue processor/ al
sys.path, asi los tests importan los modulos igual que worker.py
(`import app_client`, `import processor`, ...).

Ningun test toca la red: requests, boto3 y el cliente de Anthropic se
mockean en cada test. Las variables de entorno se fijan a valores dummy
para que config.py tenga algo que leer.
"""
import os

os.environ.setdefault("PROCESSING_SECRET", "secreto-de-prueba")
os.environ.setdefault("ASSEMBLYAI_API_KEY", "aai-de-prueba")
os.environ.setdefault("ANTHROPIC_API_KEY", "anthropic-de-prueba")
os.environ.setdefault("APP_BASE_URL", "http://app.test")

"""
Capa fina de compatibilidad: el envio del callback vive en app_client.py
(cliente HTTP unico hacia la app). Este modulo solo re-exporta los nombres
previos para quien todavia los importe; el pipeline usa app_client directo.
"""
from app_client import RespuestaCallback as CallbackResultado
from app_client import enviar_callback as enviar_resultado

__all__ = ["CallbackResultado", "enviar_resultado"]

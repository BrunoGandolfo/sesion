"""
Cliente R2 (Cloudflare) para descargar audio cifrado.

El borrado NO vive aca: el audio se elimina desde la app (crypto-shredding
en /aprobar o DELETE de la sesion), nunca desde el worker.
"""
import boto3
from botocore.config import Config as BotoConfig
import config

_client = None

def _get_client():
    global _client
    if _client is None:
        if not config.r2_configurado():
            raise RuntimeError("R2 no está configurado")
        _client = boto3.client(
            "s3",
            endpoint_url=config.R2_ENDPOINT,
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=BotoConfig(signature_version="s3v4", connect_timeout=5, read_timeout=30, retries={"max_attempts": 3}),
        )
    return _client

def descargar_segmento(key: str, bytes_esperados: int) -> bytes:
    response = _get_client().get_object(Bucket=config.R2_BUCKET_NAME, Key=key)
    body = response["Body"]
    try:
        datos = body.read(bytes_esperados + 1)
        if len(datos) != bytes_esperados:
            raise ValueError("El tamaño del segmento no coincide")
        return datos
    finally:
        body.close()

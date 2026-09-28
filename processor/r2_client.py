"""
Cliente R2 (Cloudflare) para descargar el audio. La app no lo cifra: llega
tal como lo grabo el telefono (R2 lo cifra en reposo por su cuenta).

El borrado NO vive aca: el audio se elimina desde la app (trabajo
borrar_audio_r2, al aprobar o al eliminar la sesion), nunca desde el worker.
"""
import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
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

class ErrorR2(Exception):
    """
    Fallo de R2 al bajar el audio. Lleva solo el codigo de error de S3
    (NoSuchKey, AccessDenied, ...): el mensaje de botocore repite la key, que
    lleva los ids de la organizacion y la sesion, y no va a los logs.
    """

    def __init__(self, codigo: str):
        self.codigo = codigo
        super().__init__(codigo)


def descargar_audio(key: str) -> bytes:
    """Los bytes del objeto, todo en memoria. Un error del servicio es ErrorR2."""
    try:
        response = _get_client().get_object(Bucket=config.R2_BUCKET_NAME, Key=key)
    except ClientError as e:
        raise ErrorR2(str(e.response.get("Error", {}).get("Code") or "desconocido")[:60]) from None
    return response["Body"].read()

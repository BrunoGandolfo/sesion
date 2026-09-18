"""
Descifrado AES-256-GCM compatible con src/lib/crypto.ts del frontend.
"""
import base64
from Crypto.Cipher import AES

def descifrar(datos_cifrados_b64: str, clave_b64: str, iv_b64: str) -> bytes:
    try:
        clave = base64.b64decode(clave_b64)
        iv = base64.b64decode(iv_b64)
        datos_cifrados = base64.b64decode(datos_cifrados_b64)
    except Exception as e:
        raise ValueError(f"Error decodificando base64: {e}")
    if len(clave) != 32:
        raise ValueError(f"Clave debe ser 32 bytes, recibí {len(clave)}")
    if len(iv) != 12:
        raise ValueError(f"IV debe ser 12 bytes, recibí {len(iv)}")
    if len(datos_cifrados) < 16:
        raise ValueError("Datos cifrados demasiado cortos")
    tag = datos_cifrados[-16:]
    ciphertext = datos_cifrados[:-16]
    cipher = AES.new(clave, AES.MODE_GCM, nonce=iv)
    try:
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    except Exception as e:
        raise ValueError(f"Error de descifrado: {e}")
    return plaintext

"""
Descifrado compatible con src/lib/crypto.ts: AES-256-GCM, iv de 12 bytes,
salida de WebCrypto = ciphertext || tag(16). Se cifra aca con el mismo
formato y se verifica que crypto.descifrar lo abra y detecte alteraciones.
"""
import base64
import os

import pytest
from Crypto.Cipher import AES

from crypto import descifrar


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _cifrar_como_webcrypto(plano: bytes, clave: bytes, iv: bytes) -> bytes:
    cipher = AES.new(clave, AES.MODE_GCM, nonce=iv)
    ciphertext, tag = cipher.encrypt_and_digest(plano)
    return ciphertext + tag  # mismo layout que subtle.encrypt


@pytest.fixture
def blob():
    clave = os.urandom(32)
    iv = os.urandom(12)
    plano = b"audio-webm-de-prueba" * 50
    return plano, _cifrar_como_webcrypto(plano, clave, iv), clave, iv


def test_descifra_un_blob_con_formato_webcrypto(blob):
    plano, cifrado, clave, iv = blob
    assert descifrar(_b64(cifrado), _b64(clave), _b64(iv)) == plano


def test_tamper_en_el_ciphertext_se_detecta(blob):
    _, cifrado, clave, iv = blob
    alterado = bytearray(cifrado)
    alterado[5] ^= 0x01
    with pytest.raises(ValueError, match="Error de descifrado"):
        descifrar(_b64(bytes(alterado)), _b64(clave), _b64(iv))


def test_tamper_en_el_tag_se_detecta(blob):
    _, cifrado, clave, iv = blob
    alterado = bytearray(cifrado)
    alterado[-1] ^= 0x01
    with pytest.raises(ValueError, match="Error de descifrado"):
        descifrar(_b64(bytes(alterado)), _b64(clave), _b64(iv))


def test_clave_equivocada_falla(blob):
    _, cifrado, _, iv = blob
    with pytest.raises(ValueError, match="Error de descifrado"):
        descifrar(_b64(cifrado), _b64(os.urandom(32)), _b64(iv))


def test_largos_invalidos(blob):
    _, cifrado, clave, iv = blob
    with pytest.raises(ValueError, match="32 bytes"):
        descifrar(_b64(cifrado), _b64(clave[:16]), _b64(iv))
    with pytest.raises(ValueError, match="12 bytes"):
        descifrar(_b64(cifrado), _b64(clave), _b64(iv[:8]))
    with pytest.raises(ValueError, match="demasiado cortos"):
        descifrar(_b64(b"corto"), _b64(clave), _b64(iv))


def test_base64_invalido():
    # b64decode descarta caracteres fuera del alfabeto sin quejarse; lo que
    # si lanza es un padding imposible (largo 1).
    with pytest.raises(ValueError, match="base64"):
        descifrar("A", "A", "A")

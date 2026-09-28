"""
Descarga del audio desde R2 con el cliente de boto3 de verdad y las
respuestas stubbeadas (botocore.stub.Stubber). Sin red.
"""
import io

import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber

import r2_client

BUCKET = "sesion-audio-test"


@pytest.fixture
def r2(mocker):
    """R2 configurado y el cliente cacheado de cero, envuelto en un Stubber."""
    mocker.patch.object(r2_client.config, "R2_ENDPOINT", "https://cuenta.r2.test")
    mocker.patch.object(r2_client.config, "R2_ACCESS_KEY_ID", "clave")
    mocker.patch.object(r2_client.config, "R2_SECRET_ACCESS_KEY", "secreto")
    mocker.patch.object(r2_client.config, "R2_BUCKET_NAME", BUCKET)
    mocker.patch.object(r2_client, "_client", None)
    with Stubber(r2_client._get_client()) as stubber:
        yield stubber
        stubber.assert_no_pending_responses()


def _cuerpo(datos: bytes) -> StreamingBody:
    return StreamingBody(io.BytesIO(datos), len(datos))


def test_descarga_los_bytes_de_la_key_del_bucket(r2):
    audio = b"\x1a\x45\xdf\xa3" + b"opus" * 100
    r2.add_response(
        "get_object",
        {"Body": _cuerpo(audio), "Metadata": {"origen": "telefono"}},
        {"Bucket": BUCKET, "Key": "org/s1/0"},
    )

    datos, metadata = r2_client.descargar_audio("org/s1/0")

    assert datos == audio
    assert metadata == {"origen": "telefono"}


def test_sin_metadata_devuelve_un_dict_vacio(r2):
    r2.add_response("get_object", {"Body": _cuerpo(b"x")}, {"Bucket": BUCKET, "Key": "k"})
    assert r2_client.descargar_audio("k") == (b"x", {})


def test_un_error_de_r2_se_convierte_en_runtime_error(r2):
    r2.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)

    with pytest.raises(RuntimeError):
        r2_client.descargar_audio("org/s1/0")


def test_el_cliente_se_crea_una_vez(r2):
    assert r2_client._get_client() is r2_client._get_client()


def test_sin_configuracion_no_se_crea_cliente(mocker):
    mocker.patch.object(r2_client, "_client", None)
    mocker.patch.object(r2_client.config, "R2_ENDPOINT", "")
    with pytest.raises(RuntimeError, match="no está configurado"):
        r2_client._get_client()

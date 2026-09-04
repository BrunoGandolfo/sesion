"""
Cliente REST de AssemblyAI con requests mockeado. Sin red.
"""
import logging

import pytest
import requests

import asr_assemblyai
from errores import PipelineError

MODELO_PRINCIPAL = "universal-3-5-pro"
MODELO_FALLBACK = "universal-2"

COMPLETADO = {
    "status": "completed",
    "audio_duration": 3,
    "speech_model_used": MODELO_FALLBACK,
    "utterances": [
        {"speaker": "Terapeuta", "start": 0, "end": 1000, "text": "hola"},
        {"speaker": "Paciente", "start": 1500, "end": 3000, "text": "hola"},
    ],
}


def _resp(mocker, status: int, body=None):
    r = mocker.Mock()
    r.status_code = status
    r.ok = 200 <= status < 300
    r.json.return_value = body if body is not None else {}
    return r


@pytest.fixture
def http(mocker):
    """post/get/delete mockeados; upload y transcript responden bien por defecto."""
    mocker.patch.object(asr_assemblyai.config, "ASR_MODEL_ID", MODELO_PRINCIPAL)
    mocker.patch.object(asr_assemblyai.config, "ASR_MODEL_FALLBACK", MODELO_FALLBACK)
    mocker.patch.object(asr_assemblyai.config, "ASR_TIMEOUT_SECONDS", 60)
    mocker.patch("asr_assemblyai.time.sleep")
    post = mocker.patch(
        "asr_assemblyai.requests.post",
        side_effect=[
            _resp(mocker, 200, {"upload_url": "https://cdn.test/u1"}),
            _resp(mocker, 200, {"id": "tr1"}),
        ],
    )
    get = mocker.patch("asr_assemblyai.requests.get")
    delete = mocker.patch("asr_assemblyai.requests.delete", return_value=_resp(mocker, 200))
    return mocker, post, get, delete


def test_fallback_de_modelo_reportado(http):
    mocker, post, get, delete = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    out = asr_assemblyai.transcribir(b"audio")

    # Se pidieron ambos modelos en orden y se reporta el que proceso de verdad.
    payload = post.call_args_list[1].kwargs["json"]
    assert payload["speech_models"] == [MODELO_PRINCIPAL, MODELO_FALLBACK]
    assert out["speech_model"] == MODELO_FALLBACK
    assert out["asr_id"] == "tr1"
    assert [s["speaker"] for s in out["segments"]] == ["S0", "S1"]
    assert out["roles_origen"] == "asr_role"
    assert out["duration_seconds"] == 3
    delete.assert_called_once()


def test_4xx_en_polling_corta_sin_reintentar(http):
    mocker, _, get, delete = http
    get.return_value = _resp(mocker, 401, {"error": "unauthorized"})

    with pytest.raises(PipelineError) as exc:
        asr_assemblyai.transcribir(b"audio")

    assert exc.value.codigo == "asr_error"
    assert get.call_count == 1
    delete.assert_called_once()


def test_5xx_en_polling_reintenta(http):
    mocker, _, get, _ = http
    get.side_effect = [_resp(mocker, 503), _resp(mocker, 200, COMPLETADO)]

    out = asr_assemblyai.transcribir(b"audio")

    assert get.call_count == 2
    assert out["speech_model"] == MODELO_FALLBACK


def test_5xx_persistente_agota_los_fallos(http):
    mocker, _, get, _ = http
    get.return_value = _resp(mocker, 503)

    with pytest.raises(PipelineError) as exc:
        asr_assemblyai.transcribir(b"audio")

    assert exc.value.codigo == "asr_error"
    assert get.call_count == asr_assemblyai.MAX_FALLOS_POLLING_CONSECUTIVOS


def test_timeout_de_polling(http):
    mocker, _, get, delete = http
    mocker.patch.object(asr_assemblyai.config, "ASR_TIMEOUT_SECONDS", 0)

    with pytest.raises(PipelineError) as exc:
        asr_assemblyai.transcribir(b"audio")

    assert exc.value.codigo == "asr_timeout"
    get.assert_not_called()
    delete.assert_called_once()


def test_error_de_red_en_upload(http):
    mocker, post, _, delete = http
    post.side_effect = requests.ConnectionError("boom")

    with pytest.raises(PipelineError) as exc:
        asr_assemblyai.transcribir(b"audio")

    assert exc.value.codigo == "asr_error"
    delete.assert_not_called()  # no hay transcript que borrar


def test_borra_el_transcript_aunque_falle_el_parseo(http):
    mocker, _, get, delete = http
    get.return_value = _resp(mocker, 200, COMPLETADO)
    mocker.patch("asr_assemblyai._normalizar", side_effect=ValueError("parseo roto"))

    with pytest.raises(ValueError):
        asr_assemblyai.transcribir(b"audio")

    delete.assert_called_once()
    assert delete.call_args.args[0].endswith("/transcript/tr1")


def test_sin_speech_model_used_asume_el_solicitado(http, caplog):
    mocker, _, get, _ = http
    data = {k: v for k, v in COMPLETADO.items() if k != "speech_model_used"}
    get.return_value = _resp(mocker, 200, data)

    with caplog.at_level(logging.WARNING, logger="asr_assemblyai"):
        out = asr_assemblyai.transcribir(b"audio")

    assert out["speech_model"] == MODELO_PRINCIPAL
    assert any("speech_model_used" in r.getMessage() for r in caplog.records)


def test_los_logs_no_contienen_texto_de_la_transcripcion(http, caplog):
    mocker, _, get, _ = http
    data = dict(COMPLETADO)
    data["utterances"] = [
        {"speaker": "Paciente", "start": 0, "end": 1000, "text": "FRASE-SECRETA"},
    ]
    get.return_value = _resp(mocker, 200, data)

    with caplog.at_level(logging.DEBUG):
        asr_assemblyai.transcribir(b"audio")

    assert all("FRASE-SECRETA" not in r.getMessage() for r in caplog.records)

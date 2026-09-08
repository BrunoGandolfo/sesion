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


# Keyterms (HotWords) ───────────────────────────────────────────────────────
#
# Segun la guia de Universal-3.5 Pro, `prompt` y `keyterms_prompt` son las dos
# maneras de darle contexto al modelo y conviven en la misma request:
#   https://www.assemblyai.com/docs/pre-recorded-audio/universal-3-5-pro/prompting


def _payload_transcript(post):
    """El body del POST /v2/transcript (la segunda llamada; la primera es upload)."""
    return post.call_args_list[1].kwargs["json"]


def test_sin_keyterms_el_payload_sale_igual_que_antes(http):
    mocker, post, get, _ = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio")

    # No se manda la clave vacia: la request es identica a la de antes de HotWords.
    assert "keyterms_prompt" not in _payload_transcript(post)


def test_lista_vacia_tampoco_manda_la_clave(http):
    mocker, post, get, _ = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio", [])

    assert "keyterms_prompt" not in _payload_transcript(post)


def test_none_es_lo_mismo_que_no_pasar_nada(http):
    mocker, post, get, _ = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio", None)

    assert "keyterms_prompt" not in _payload_transcript(post)


def test_los_terminos_viajan_en_keyterms_prompt_junto_al_prompt(http):
    mocker, post, get, _ = http
    mocker.patch.object(
        asr_assemblyai.config, "ASR_PROMPT_ESCENARIO", "Sesion de psicoterapia."
    )
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio", ["MITI 4.2.1", "alianza terapéutica"])

    payload = _payload_transcript(post)
    assert payload["keyterms_prompt"] == ["MITI 4.2.1", "alianza terapéutica"]
    # Lo importante: los dos parametros conviven. La receta vieja de
    # Universal-3 Pro era pegar los terminos dentro del prompt; hoy la guia
    # pide lo contrario ("Don't pack lists of keywords into the contextual
    # prompt"), asi que el prompt queda intacto.
    assert payload["prompt"] == "Sesion de psicoterapia."


def test_sin_prompt_configurado_los_keyterms_igual_salen(http):
    mocker, post, get, _ = http
    mocker.patch.object(asr_assemblyai.config, "ASR_PROMPT_ESCENARIO", "")
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio", ["disociación"])

    payload = _payload_transcript(post)
    assert payload["keyterms_prompt"] == ["disociación"]
    assert "prompt" not in payload


def test_saneamiento_llega_al_payload(http):
    mocker, post, get, _ = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    asr_assemblyai.transcribir(b"audio", ["  ", "GTFS", "GTFS", "", "CTS-R"])

    assert _payload_transcript(post)["keyterms_prompt"] == ["GTFS", "CTS-R"]


def test_el_log_dice_cuantos_terminos_pero_no_cuales(http, caplog):
    mocker, _, get, _ = http
    get.return_value = _resp(mocker, 200, COMPLETADO)

    with caplog.at_level(logging.DEBUG):
        asr_assemblyai.transcribir(b"audio", ["Mariana", "NOMBRE-SECRETO"])

    mensajes = [r.getMessage() for r in caplog.records]
    assert any("2 keyterms" in m for m in mensajes)
    # Un termino puede ser el nombre propio de la paciente: nunca al log.
    assert all("NOMBRE-SECRETO" not in m for m in mensajes)
    assert all("Mariana" not in m for m in mensajes)


# Saneamiento, unidad ───────────────────────────────────────────────────────


def test_sanear_descarta_vacios_y_lo_que_no_sea_texto():
    entrada = ["", "   ", "\n\t", None, 42, ["GTFS"], {"a": 1}, "válido"]
    assert asr_assemblyai._sanear_keyterms(entrada) == ["válido"]


def test_sanear_corta_a_seis_palabras_por_termino():
    largo = "uno dos tres cuatro cinco seis siete ocho"
    assert asr_assemblyai._sanear_keyterms([largo]) == [
        "uno dos tres cuatro cinco seis"
    ]


def test_sanear_deja_intacto_el_termino_de_exactamente_seis_palabras():
    justo = "uno dos tres cuatro cinco seis"
    assert asr_assemblyai._sanear_keyterms([justo]) == [justo]


def test_sanear_normaliza_el_espacio_de_sobra():
    assert asr_assemblyai._sanear_keyterms(["  alianza   terapéutica  "]) == [
        "alianza terapéutica"
    ]


def test_sanear_deduplica_conservando_el_orden():
    entrada = ["GTFS", "MITI", "GTFS", "CTS-R", "MITI"]
    assert asr_assemblyai._sanear_keyterms(entrada) == ["GTFS", "MITI", "CTS-R"]


def test_sanear_deduplica_lo_que_el_corte_dejo_igual():
    # Dos terminos distintos en el origen que, cortados a seis palabras,
    # quedan identicos: se manda uno.
    entrada = [
        "uno dos tres cuatro cinco seis siete",
        "uno dos tres cuatro cinco seis ocho",
    ]
    assert asr_assemblyai._sanear_keyterms(entrada) == [
        "uno dos tres cuatro cinco seis"
    ]


def test_sanear_no_baja_el_caso_al_deduplicar():
    # "Mariana" y "mariana" no son el mismo termino para el ASR: pasar el
    # nombre propio con su mayuscula es justamente el punto.
    assert asr_assemblyai._sanear_keyterms(["Mariana", "mariana"]) == [
        "Mariana",
        "mariana",
    ]


def test_sanear_respeta_el_tope_total():
    entrada = [f"termino{i}" for i in range(asr_assemblyai.MAX_KEYTERMS + 50)]

    saneados = asr_assemblyai._sanear_keyterms(entrada)

    assert len(saneados) == asr_assemblyai.MAX_KEYTERMS
    # Se conservan los primeros: la app los manda ordenados por relevancia.
    assert saneados[0] == "termino0"
    assert saneados[-1] == f"termino{asr_assemblyai.MAX_KEYTERMS - 1}"


def test_el_tope_es_el_del_modelo_mas_chico_de_speech_models():
    # La referencia de POST /v2/transcript: "up to 200 (for Universal-2) or
    # 1000 (for Universal-3.5 Pro)". La request manda los dos modelos y cual
    # procesa el audio lo decide AssemblyAI, asi que el techo es el de 200.
    assert asr_assemblyai.MAX_KEYTERMS == 200
    assert asr_assemblyai.MAX_PALABRAS_POR_KEYTERM == 6


def test_sanear_no_toca_la_lista_que_recibe():
    entrada = ["GTFS", "GTFS"]
    asr_assemblyai._sanear_keyterms(entrada)
    assert entrada == ["GTFS", "GTFS"]

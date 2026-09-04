"""
Cliente HTTP unico hacia la app: header Bearer, timeouts y semantica de
status. requests mockeado; sin red.
"""
import pytest
import requests

import app_client
import config


def _resp(mocker, status: int, body=None, text: str = ""):
    r = mocker.Mock()
    r.status_code = status
    r.ok = 200 <= status < 300
    r.text = text
    r.json.return_value = body if body is not None else {}
    if status >= 400:
        r.raise_for_status.side_effect = requests.HTTPError(f"HTTP {status}")
    else:
        r.raise_for_status.return_value = None
    return r


BEARER = f"Bearer {config.PROCESSING_SECRET}"


# Lecturas ──────────────────────────────────────────────────────────────────

def test_obtener_pendientes_manda_bearer_y_devuelve_la_lista(mocker):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, [{"sesionClinicaId": "s1"}]))

    assert app_client.obtener_pendientes() == [{"sesionClinicaId": "s1"}]

    kwargs = get.call_args.kwargs
    assert get.call_args.args[0] == config.PENDIENTES_URL
    assert kwargs["headers"] == {"Authorization": BEARER}
    assert kwargs["timeout"] == app_client.TIMEOUT_LECTURA_SEG


def test_obtener_pendientes_ignora_cuerpos_que_no_son_lista(mocker):
    mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, {"data": []}))
    assert app_client.obtener_pendientes() == []


def test_obtener_pendientes_propaga_5xx(mocker):
    mocker.patch("app_client.requests.get", return_value=_resp(mocker, 503))
    with pytest.raises(requests.RequestException):
        app_client.obtener_pendientes()


def test_obtener_aprobadas_usa_su_url(mocker):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, []))
    assert app_client.obtener_aprobadas_sin_contexto() == []
    assert get.call_args.args[0] == config.APROBADAS_URL


def test_contexto_llm_devuelve_texto_o_none(mocker):
    get = mocker.patch("app_client.requests.get")

    get.return_value = _resp(mocker, 200, text="  # contexto  \n")
    assert app_client.obtener_contexto_clinico_llm("p1") == "# contexto"
    assert get.call_args.kwargs["params"] == {"format": "llm"}
    assert get.call_args.kwargs["headers"] == {"Authorization": BEARER}

    get.return_value = _resp(mocker, 404)
    assert app_client.obtener_contexto_clinico_llm("p1") is None

    get.return_value = _resp(mocker, 200, text="   ")
    assert app_client.obtener_contexto_clinico_llm("p1") is None

    get.side_effect = requests.ConnectionError("boom")
    assert app_client.obtener_contexto_clinico_llm("p1") is None


# Callback ──────────────────────────────────────────────────────────────────

def test_callback_2xx_es_ok_y_terminal(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))

    res = app_client.enviar_callback("s1", "revision", nota={"plan": "p"}, modelo_asr="a")

    assert res.ok and res.status == 200 and res.terminal
    kwargs = post.call_args.kwargs
    assert post.call_args.args[0] == config.CALLBACK_URL
    assert kwargs["headers"] == {"Authorization": BEARER, "Content-Type": "application/json"}
    assert kwargs["timeout"] == app_client.TIMEOUT_ESCRITURA_SEG
    assert kwargs["json"] == {
        "sesionClinicaId": "s1",
        "estado": "revision",
        "nota": {"plan": "p"},
        "modeloASR": "a",
    }


def test_callback_409_no_es_ok_pero_es_terminal(mocker):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 409, {"error": "ya no esta"}))
    res = app_client.enviar_callback("s1", "revision")
    assert not res.ok and res.status == 409 and res.terminal


def test_callback_4xx_es_terminal(mocker):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 422, {"error": "Datos inválidos"}))
    res = app_client.enviar_callback("s1", "revision")
    assert not res.ok and res.status == 422 and res.terminal


def test_callback_5xx_no_es_terminal(mocker):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 503))
    res = app_client.enviar_callback("s1", "revision")
    assert not res.ok and res.status == 503 and not res.terminal


def test_callback_sin_respuesta_no_es_terminal_y_no_lanza(mocker):
    mocker.patch("app_client.requests.post", side_effect=requests.ConnectionError("boom"))
    res = app_client.enviar_callback("s1", "error", error="asr_error: x")
    assert not res.ok and res.status is None and not res.terminal


def test_callback_no_loguea_el_payload(mocker, caplog):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))
    with caplog.at_level("DEBUG"):
        app_client.enviar_callback("s1", "revision", transcripcion="FRASE-SECRETA")
    assert all("FRASE-SECRETA" not in r.getMessage() for r in caplog.records)


# Contexto ──────────────────────────────────────────────────────────────────

def test_actualizar_contexto_devuelve_status(mocker):
    patch = mocker.patch("app_client.requests.patch", return_value=_resp(mocker, 200))

    assert app_client.actualizar_contexto("p1", {"ultimaSesionId": "s1"}) == 200

    kwargs = patch.call_args.kwargs
    assert patch.call_args.args[0] == config.contexto_clinico_url("p1")
    assert kwargs["json"] == {"ultimaSesionId": "s1"}
    assert kwargs["headers"] == {"Authorization": BEARER, "Content-Type": "application/json"}
    assert kwargs["timeout"] == app_client.TIMEOUT_ESCRITURA_SEG


def test_actualizar_contexto_lanza_con_el_status(mocker):
    mocker.patch("app_client.requests.patch", return_value=_resp(mocker, 400))
    with pytest.raises(RuntimeError, match="HTTP 400"):
        app_client.actualizar_contexto("p1", {})

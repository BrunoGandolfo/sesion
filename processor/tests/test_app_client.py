"""
Cliente HTTP unico hacia la app: dos credenciales (PROCESSING_SECRET para
reclamar, ticket para todo lo demas), latido en los headers, timeouts y
semantica de status. requests mockeado; sin red.
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
    r.headers = {"Content-Type": "application/json; charset=utf-8"}
    r.json.return_value = body if body is not None else {}
    if status >= 400:
        r.raise_for_status.side_effect = requests.HTTPError(f"HTTP {status}")
    else:
        r.raise_for_status.return_value = None
    return r


SECRETO = f"Bearer {config.PROCESSING_SECRET}"
TICKET = "a" * 64
LATIDO = {"X-Worker-Id": app_client.WORKER_ID, "X-Worker-Version": config.WORKER_VERSION}


# Reclamos (PROCESSING_SECRET) ─────────────────────────────────────────────

def test_obtener_pendientes_manda_el_secreto_y_el_latido(mocker):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, [{"sesionClinicaId": "s1"}]))

    assert app_client.obtener_pendientes() == [{"sesionClinicaId": "s1"}]

    # De a una: lo que espera en una cola local perderia el lease.
    assert get.call_args.args[0] == f"{config.PENDIENTES_URL}?limite=1"
    assert get.call_args.kwargs["headers"] == {"Authorization": SECRETO, **LATIDO}
    assert get.call_args.kwargs["timeout"] == app_client.TIMEOUT_LECTURA_SEG


def test_obtener_pendientes_rechaza_cuerpos_que_no_son_lista(mocker):
    mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, {"data": []}))
    with pytest.raises(requests.RequestException):
        app_client.obtener_pendientes()


def test_obtener_pendientes_propaga_5xx(mocker):
    mocker.patch("app_client.requests.get", return_value=_resp(mocker, 503))
    with pytest.raises(requests.RequestException):
        app_client.obtener_pendientes()


def test_trabajos_pendientes_pide_solo_los_tipos_que_sabe_ejecutar(mocker):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, [{"trabajoId": "t1"}]))
    assert app_client.trabajos_pendientes(["borrar_transcript_asr", "generar_feedback"]) == [{"trabajoId": "t1"}]
    assert get.call_args.args[0] == f"{config.APP_BASE_URL}/api/trabajos/pendientes?tipos=borrar_transcript_asr,generar_feedback"
    assert get.call_args.kwargs["headers"]["Authorization"] == SECRETO


# Escrituras con ticket ─────────────────────────────────────────────────────

def test_lease_va_con_el_ticket_el_intento_y_el_paso(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))

    res = app_client.renovar_lease("s1", TICKET, 2, paso="asr")

    assert res.ok and res.terminal and not res.rechazado
    assert post.call_args.args[0] == f"{config.APP_BASE_URL}/api/sesion-clinica/s1/lease"
    assert post.call_args.kwargs["headers"] == {"Authorization": f"Bearer {TICKET}", "Content-Type": "application/json", **LATIDO}
    assert post.call_args.kwargs["json"] == {"intento": 2, "paso": "asr"}
    assert post.call_args.kwargs["timeout"] == app_client.TIMEOUT_ESCRITURA_SEG


def test_registrar_asr_y_transcripcion_llevan_intento(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))

    app_client.registrar_asr("s1", TICKET, 3, "tr-9")
    assert post.call_args.args[0].endswith("/api/sesion-clinica/s1/asr")
    assert post.call_args.kwargs["json"] == {"intento": 3, "transcriptId": "tr-9"}

    app_client.registrar_transcripcion(
        "s1", TICKET, 3, "[00:00] T: hola", "assemblyai:universal-2",
        speech_analytics={"ratio": 1}, duracion_seg=61.7, asr_transcript_id="tr-9",
    )
    assert post.call_args.args[0].endswith("/api/sesion-clinica/s1/transcripcion")
    assert post.call_args.kwargs["json"] == {
        "intento": 3,
        "transcripcion": "[00:00] T: hola",
        "modeloAsr": "assemblyai:universal-2",
        "speechAnalytics": {"ratio": 1},
        "duracionSeg": 61,
        "asrTranscriptId": "tr-9",
    }


def test_registrar_transcripcion_manda_el_aviso_de_duracion_solo_si_hay(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))

    aviso = {"duracionTelefonoSeg": 3232, "excesoPct": 403.4}
    app_client.registrar_transcripcion("s1", TICKET, 1, "x", "m", duracion_seg=16269, aviso_duracion=aviso)
    assert post.call_args.kwargs["json"]["avisoDuracion"] == aviso

    app_client.registrar_transcripcion("s1", TICKET, 1, "x", "m", duracion_seg=3232, aviso_duracion=None)
    assert "avisoDuracion" not in post.call_args.kwargs["json"]


def test_enviar_resultado_manda_el_payload_tal_cual(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))
    payload = {"intento": 1, "resultado": "fallo", "codigo": "asr_timeout", "definitivo": False}
    res = app_client.enviar_resultado("s1", TICKET, payload)
    assert res.ok
    assert post.call_args.args[0].endswith("/api/sesion-clinica/s1/resultado")
    assert post.call_args.kwargs["json"] == payload


def test_resolver_trabajo_usa_el_ticket_del_trabajo(mocker):
    post = mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))
    app_client.resolver_trabajo("t1", TICKET, {"ok": True})
    assert post.call_args.args[0] == f"{config.APP_BASE_URL}/api/trabajos/t1/resultado"
    assert post.call_args.kwargs["headers"]["Authorization"] == f"Bearer {TICKET}"


# Semantica de status ───────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [401, 409])
def test_401_y_409_son_rechazo_terminal(mocker, status):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, status, {"error": "ya no es el vigente"}))
    res = app_client.enviar_resultado("s1", TICKET, {"intento": 1, "resultado": "nota"})
    assert not res.ok and res.rechazado and res.terminal


def test_4xx_de_contrato_es_terminal_pero_no_rechazo(mocker):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 422, {"error": "Datos inválidos"}))
    res = app_client.enviar_resultado("s1", TICKET, {})
    assert not res.ok and not res.rechazado and res.terminal


def test_5xx_y_sin_respuesta_no_son_terminales_y_no_lanzan(mocker):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 503))
    res = app_client.enviar_resultado("s1", TICKET, {})
    assert not res.ok and res.status == 503 and not res.terminal

    mocker.patch("app_client.requests.post", side_effect=requests.ConnectionError("boom"))
    res = app_client.renovar_lease("s1", TICKET, 1)
    assert not res.ok and res.status is None and not res.terminal


def test_las_escrituras_no_loguean_el_payload(mocker, caplog):
    mocker.patch("app_client.requests.post", return_value=_resp(mocker, 200))
    with caplog.at_level("DEBUG"):
        app_client.registrar_transcripcion("s1", TICKET, 1, "FRASE-SECRETA", "m")
        app_client.enviar_resultado("s1", TICKET, {"intento": 1, "resultado": "nota", "nota": {"plan": "FRASE-SECRETA"}})
    assert all("FRASE-SECRETA" not in r.getMessage() for r in caplog.records)


# Contexto para el prompt ───────────────────────────────────────────────────

def test_contexto_llm_vacio_explicito_y_ticket(mocker):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, {
        "data": {"tipo": "hilo_vigente", "pacienteId": "p1", "version": 0, "contenido": None},
    }))
    assert app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET) is None
    assert get.call_args.kwargs["params"] == {"format": "llm", "sesionId": "s1"}
    assert get.call_args.kwargs["allow_redirects"] is False
    assert get.call_args.kwargs["headers"]["Authorization"] == f"Bearer {TICKET}"


@pytest.mark.parametrize("status", [301, 302, 307, 308, 204, 401, 404, 500])
def test_contexto_no_confunde_http_inesperado_con_hilo_vacio(mocker, status):
    get = mocker.patch("app_client.requests.get", return_value=_resp(mocker, status))
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET)
    assert get.call_count == 1
    assert get.call_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize("mime", ["text/html", "text/plain", ""])
def test_contexto_rechaza_login_aunque_sea_200(mocker, mime):
    resp = _resp(mocker, 200, text="<html>login</html>")
    resp.headers = {"Content-Type": mime}
    mocker.patch("app_client.requests.get", return_value=resp)
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET)


@pytest.mark.parametrize("body", [[], {}, {"data": None}, {"data": {"tipo": "hilo_vigente", "pacienteId": "otra", "version": 0, "contenido": None}}, {"data": {"tipo": "hilo_vigente", "pacienteId": "p1", "version": 1, "contenido": {}}}])
def test_contexto_valida_forma_e_identidad(mocker, body):
    mocker.patch("app_client.requests.get", return_value=_resp(mocker, 200, body))
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET)


def test_contexto_red_y_json_roto_son_error(mocker):
    get = mocker.patch("app_client.requests.get", side_effect=requests.ConnectionError())
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET)
    get.side_effect = None
    get.return_value = _resp(mocker, 200)
    get.return_value.json.side_effect = ValueError("JSON roto")
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", TICKET)

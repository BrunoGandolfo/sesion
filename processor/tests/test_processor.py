"""
Orquestacion de procesar_sesion con todos los pasos mockeados: checkpoint,
resultado nota, fallos transitorios/definitivos, lease perdido, y los
trabajos durables. Sin red.
"""
import logging

import pytest

import config
import processor
from app_client import RespuestaApp
from errores import LeasePerdido, PipelineError
from processor import SesionReclamada

TRANSCRIPCION = {
    "duration_seconds": 3,
    "segments": [{"speaker": "S0", "start": 0.0, "end": 1.0, "text": "hola"}],
    "roles_origen": "asr_role",
    "asr_id": "tr1",
    "speech_model": "universal-2",
}

NOTA = {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"}
LLM = f"anthropic:{config.LLM_MODEL_ID}"
TICKET = "a" * 64


def sesion(**extra) -> SesionReclamada:
    base = dict(
        sesion_clinica_id="s1",
        intento=2,
        ticket=TICKET,
        paciente_id="p1",
        terminos_asr=["GTFS"],
        audio={"key": "org/s1/0"},
        checkpoint=None,
    )
    base.update(extra)
    return SesionReclamada(**base)


@pytest.fixture
def pasos(mocker):
    """Pasos exitosos por defecto; cada test rompe el que le interesa."""
    mocker.patch("processor.LEASE_RENOVACION_SEG", 3600)
    mocker.patch("processor.descargar_audio", return_value=b"audio")
    mocker.patch("processor.preparar_para_asr", side_effect=lambda _etiqueta, audio: audio)
    mocker.patch("processor.transcribir", return_value=TRANSCRIPCION)
    mocker.patch("processor.speech_analytics.compute", return_value={"ratio": 1})
    mocker.patch("processor.formatear_para_llm", return_value="[00:00] Terapeuta: hola")
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    mocker.patch(
        "processor.clinical_analyzer.analizar",
        return_value=({"nota": NOTA, "datosEstructurados": {"temas": ["x"]}}, "clinical_note_v4.md", _diag()),
    )
    ok = RespuestaApp(ok=True, status=200)
    return {
        "mocker": mocker,
        "asr": mocker.patch("processor.app_client.registrar_asr", return_value=ok),
        "checkpoint": mocker.patch("processor.app_client.registrar_transcripcion", return_value=ok),
        "resultado": mocker.patch("processor.app_client.enviar_resultado", return_value=ok),
        "lease": mocker.patch("processor.app_client.renovar_lease", return_value=ok),
    }


def _diag(advertencias=None, reintentos=0):
    from clinical_analyzer import DiagnosticoLLM

    return DiagnosticoLLM(reintentos=reintentos, advertencias=advertencias or [])


# Camino feliz ──────────────────────────────────────────────────────────────

def test_registra_el_asr_y_el_checkpoint_antes_del_modelo_y_entrega_la_nota(pasos):
    orden: list[str] = []
    pasos["asr"].side_effect = lambda *a, **k: orden.append("asr") or RespuestaApp(True, 200)
    pasos["checkpoint"].side_effect = lambda *a, **k: orden.append("checkpoint") or RespuestaApp(True, 200)
    pasos["mocker"].patch("processor.analizar", side_effect=lambda *a, **k: orden.append("nota") or processor.Analisis(NOTA, {"temas": ["x"]}, "clinical_note_v4.md"))

    processor.procesar_sesion(sesion())

    assert orden == ["asr", "checkpoint", "nota"]
    pasos["asr"].assert_called_once_with("s1", TICKET, 2, "tr1")
    kw = pasos["checkpoint"].call_args
    assert kw.args[:3] == ("s1", TICKET, 2)
    assert kw.args[3] == "[00:00] Terapeuta: hola"
    assert kw.args[4] == "assemblyai:universal-2"
    assert kw.kwargs["speech_analytics"] == {"ratio": 1, "rolesOrigen": "asr_role"}
    assert kw.kwargs["asr_transcript_id"] == "tr1"

    pasos["resultado"].assert_called_once()
    sid, ticket, payload = pasos["resultado"].call_args.args
    assert (sid, ticket) == ("s1", TICKET)
    uso = payload.pop("uso")
    assert uso["asrSegundos"] == 3
    assert set(uso["pasosMs"]) == {"descarga", "normalizacion", "asr"}
    assert payload == {
        "intento": 2,
        "resultado": "nota",
        "nota": NOTA,
        "datos": {"temas": ["x"]},
        "modeloLlm": LLM,
        "promptVersion": "clinical_note_v4.md",
    }


def test_analizar_no_genera_feedback_y_suma_speech_analytics(pasos):
    feedback = pasos["mocker"].patch("processor.clinical_analyzer.generar_feedback_terapeuta")

    processor.procesar_sesion(sesion())

    feedback.assert_not_called()
    payload = pasos["resultado"].call_args.args[2]
    assert payload["datos"]["speechAnalytics"] == {"ratio": 1, "rolesOrigen": "asr_role"}
    assert "feedbackTerapeuta" not in payload["datos"]
    assert "_pipeline" not in payload["datos"]


def test_con_checkpoint_no_descarga_ni_transcribe(pasos):
    descargar = pasos["mocker"].patch("processor.descargar_audio")
    transcribir = pasos["mocker"].patch("processor.transcribir")

    processor.procesar_sesion(
        sesion(audio=None, checkpoint={"transcripcion": "[00:00] T: hola", "speechAnalytics": {"ratio": 2}, "modeloAsr": "assemblyai:x"})
    )

    descargar.assert_not_called()
    transcribir.assert_not_called()
    pasos["asr"].assert_not_called()
    pasos["checkpoint"].assert_not_called()
    payload = pasos["resultado"].call_args.args[2]
    assert payload["resultado"] == "nota"
    assert payload["datos"]["speechAnalytics"] == {"ratio": 2}


# Registro del transcript antes del polling (H1) ──────────────────────────

# La funcion real: el fixture `pasos` la reemplaza por un doble.
TRANSCRIBIR_REAL = processor.transcribir


def _asr_real(mocker, get_side_effect):
    """processor.transcribir y asr_assemblyai de verdad, con la red de AssemblyAI mockeada."""
    mocker.patch("processor.transcribir", side_effect=TRANSCRIBIR_REAL)
    mocker.patch("asr_assemblyai.time.sleep")
    mocker.patch(
        "asr_assemblyai.requests.post",
        side_effect=[
            mocker.Mock(ok=True, status_code=200, **{"json.return_value": {"upload_url": "https://cdn.test/u1"}}),
            mocker.Mock(ok=True, status_code=200, **{"json.return_value": {"id": "tr1"}}),
        ],
    )
    mocker.patch("asr_assemblyai.requests.get", side_effect=get_side_effect)
    return mocker.patch("asr_assemblyai.requests.delete", return_value=mocker.Mock(status_code=200))


def test_con_el_proceso_muerto_en_el_polling_la_app_ya_tiene_el_transcript_id(pasos):
    orden: list[str] = []
    pasos["asr"].side_effect = lambda *a, **k: orden.append("registrar_asr") or RespuestaApp(True, 200)

    def muere(*_a, **_k):
        orden.append("polling")
        raise SystemExit(137)  # SIGKILL/OOM: nada lo atrapa

    _asr_real(pasos["mocker"], muere)

    with pytest.raises(SystemExit):
        processor.procesar_sesion(sesion())

    assert orden == ["registrar_asr", "polling"]
    pasos["asr"].assert_called_once_with("s1", TICKET, 2, "tr1")
    pasos["resultado"].assert_not_called()


def test_el_transcript_registrado_antes_del_polling_no_se_registra_de_nuevo(pasos):
    completado = {"status": "completed", "audio_duration": 3, "speech_model_used": "universal-2", "utterances": [
        {"speaker": "Terapeuta", "start": 0, "end": 1000, "text": "hola"}]}
    _asr_real(pasos["mocker"], lambda *a, **k: pasos["mocker"].Mock(ok=True, status_code=200, **{"json.return_value": completado}))

    processor.procesar_sesion(sesion())

    pasos["asr"].assert_called_once_with("s1", TICKET, 2, "tr1")
    assert pasos["checkpoint"].call_args.kwargs["asr_transcript_id"] == "tr1"
    assert pasos["resultado"].call_args.args[2]["resultado"] == "nota"


def test_si_el_registro_temprano_falla_se_reintenta_en_el_checkpoint(pasos):
    def transcribir(_etiqueta, _audio, _terminos, al_crear=None):
        al_crear("tr1")
        return TRANSCRIPCION

    pasos["mocker"].patch("processor.transcribir", side_effect=transcribir)
    pasos["asr"].side_effect = [RespuestaApp(False, 503), RespuestaApp(True, 200)]

    processor.procesar_sesion(sesion())

    assert pasos["asr"].call_count == 2
    assert pasos["resultado"].call_args.args[2]["resultado"] == "nota"


def test_un_409_al_registrar_el_transcript_lo_borra_y_abandona(pasos):
    delete = _asr_real(pasos["mocker"], lambda *a, **k: pytest.fail("no se espera un transcript ajeno"))
    pasos["asr"].return_value = RespuestaApp(False, 409)

    processor.procesar_sesion(sesion())

    delete.assert_called_once()
    assert delete.call_args.args[0].endswith("/transcript/tr1")
    pasos["checkpoint"].assert_not_called()
    pasos["resultado"].assert_not_called()


# Fallos ────────────────────────────────────────────────────────────────────

def test_fallo_transitorio_en_asr_se_informa_como_no_definitivo_con_el_paso(pasos):
    pasos["mocker"].patch("processor.transcribir", side_effect=PipelineError("asr_timeout", "AssemblyAI no completo"))

    processor.procesar_sesion(sesion())

    payload = pasos["resultado"].call_args.args[2]
    uso = payload.pop("uso")
    # El ASR fallo: se sabe cuanto tardo, no cuanto se facturo.
    assert "asrSegundos" not in uso and "asr" in uso["pasosMs"]
    assert payload == {
        "intento": 2,
        "resultado": "fallo",
        "codigo": "asr_timeout",
        "definitivo": False,
        "paso": "asr",
        "detalle": "AssemblyAI no completo",
    }


def test_fallo_definitivo_en_el_archivo(pasos):
    pasos["mocker"].patch("processor.descargar_audio", side_effect=PipelineError("audio_varias_cabeceras", "No se pudo abrir el audio"))

    processor.procesar_sesion(sesion())

    payload = pasos["resultado"].call_args.args[2]
    assert payload["resultado"] == "fallo"
    assert payload["codigo"] == "audio_varias_cabeceras"
    assert payload["definitivo"] is True
    assert payload["paso"] == "audio"


def test_excepcion_inesperada_es_error_interno_transitorio_sin_traza(pasos, caplog):
    pasos["mocker"].patch("processor.analizar", side_effect=KeyError("segments"))

    with caplog.at_level("ERROR"):
        processor.procesar_sesion(sesion())

    payload = pasos["resultado"].call_args.args[2]
    assert payload["codigo"] == "error_interno" and payload["definitivo"] is False
    assert all(r.exc_info is None for r in caplog.records)


def test_si_la_app_no_guarda_el_checkpoint_el_fallo_es_transitorio_y_no_se_llama_al_modelo(pasos):
    pasos["checkpoint"].return_value = RespuestaApp(ok=False, status=503)
    analizar = pasos["mocker"].patch("processor.analizar")

    processor.procesar_sesion(sesion())

    analizar.assert_not_called()
    payload = pasos["resultado"].call_args.args[2]
    assert payload["codigo"] == "app_error" and payload["definitivo"] is False


def test_resultado_no_terminal_no_lanza_ni_informa_fallo(pasos):
    pasos["resultado"].return_value = RespuestaApp(ok=False, status=503)

    processor.procesar_sesion(sesion())

    assert pasos["resultado"].call_count == 1
    assert pasos["resultado"].call_args.args[2]["resultado"] == "nota"


# Lease e identidad del intento ─────────────────────────────────────────────

def test_un_409_en_el_checkpoint_abandona_sin_informar_nada(pasos):
    pasos["checkpoint"].return_value = RespuestaApp(ok=False, status=409)
    analizar = pasos["mocker"].patch("processor.analizar")

    processor.procesar_sesion(sesion())

    analizar.assert_not_called()
    pasos["resultado"].assert_not_called()


def test_un_409_en_el_resultado_abandona_sin_informar_fallo(pasos):
    pasos["resultado"].return_value = RespuestaApp(ok=False, status=409)

    processor.procesar_sesion(sesion())

    assert pasos["resultado"].call_count == 1


def test_el_lease_perdido_corta_el_pipeline_antes_del_paso_siguiente(pasos):
    lease_actual = {}
    original = processor.Lease.__enter__

    def enter(self):
        lease_actual["lease"] = self
        return original(self)

    pasos["mocker"].patch.object(processor.Lease, "__enter__", enter)

    def transcribir(*a, **k):
        # Otro reclamo se llevo la sesion mientras se transcribia.
        lease_actual["lease"].perdido = True
        return TRANSCRIPCION

    pasos["mocker"].patch("processor.transcribir", side_effect=transcribir)
    # El checkpoint se intenta igual (es idempotente y el 409 lo cortaria);
    # simulamos que la app ya no lo acepta.
    pasos["checkpoint"].return_value = RespuestaApp(ok=False, status=409)

    processor.procesar_sesion(sesion())

    pasos["resultado"].assert_not_called()


def test_el_lease_se_renueva_con_ticket_intento_y_paso(pasos):
    lease = processor.Lease(sesion(), intervalo_seg=3600)
    lease.paso = "asr"
    lease.renovar()
    pasos["lease"].assert_called_once_with("s1", TICKET, 2, "asr")
    assert lease.perdido is False

    pasos["lease"].return_value = RespuestaApp(ok=False, status=409)
    lease.renovar()
    assert lease.perdido is True
    with pytest.raises(LeasePerdido):
        lease.comprobar("nota")


def test_el_lease_se_renueva_solo_en_segundo_plano(pasos):
    import time

    with processor.Lease(sesion(), intervalo_seg=0.05):
        time.sleep(0.3)
    assert pasos["lease"].call_count >= 2


def test_un_5xx_del_lease_no_lo_pierde(pasos):
    pasos["lease"].return_value = RespuestaApp(ok=False, status=503)
    lease = processor.Lease(sesion(), intervalo_seg=3600)
    lease.renovar()
    assert lease.perdido is False


# Pasos reales ──────────────────────────────────────────────────────────────

# Cabecera real de un WebM de MediaRecorder de Chrome y la que escribe ffmpeg:
# id EBML, tamano (1 u 8 bytes) y el elemento EBMLVersion.
CABECERA_CHROME = bytes.fromhex("1a45dfa39f4286810142f7810142f2810442f381084282847765626d")
CABECERA_FFMPEG = bytes.fromhex("1a45dfa3010000000000002342868101")


def test_descargar_entrega_el_audio_tal_cual_sin_clave_ni_iv(mocker):
    descargas = []
    archivo = CABECERA_CHROME + b"opus" * 50
    mocker.patch("processor.r2_client.descargar_audio", side_effect=lambda key: (descargas.append(key) or (archivo, {})))
    assert processor.descargar_audio("s1", {"key": "org/s1/0"}, 1) == archivo
    assert descargas == ["org/s1/0"]


def test_descargar_sin_key_es_definitivo():
    for audio in ({"key": ""}, {}, None):
        with pytest.raises(PipelineError) as exc:
            processor.descargar_audio("s1", audio, 1)
        assert exc.value.codigo == "audio_sin_key" and exc.value.definitivo


def test_descargar_con_r2_caido_es_transitorio(mocker):
    mocker.patch("processor.r2_client.descargar_audio", side_effect=RuntimeError("boom"))
    with pytest.raises(PipelineError) as exc:
        processor.descargar_audio("s1", {"key": "k"}, 1)
    assert exc.value.codigo == "r2_error" and not exc.value.definitivo


@pytest.mark.parametrize("segunda", [CABECERA_CHROME, CABECERA_FFMPEG])
def test_dos_grabaciones_pegadas_se_rechazan_antes_del_asr(mocker, segunda):
    # Lo que producia reanudar con un MediaRecorder nuevo: dos archivos pegados.
    pegado = CABECERA_CHROME + b"a" * 4000 + segunda + b"b" * 4000
    mocker.patch("processor.r2_client.descargar_audio", return_value=(pegado, {}))
    asr = mocker.patch("processor.asr_assemblyai.transcribir")
    with pytest.raises(PipelineError) as exc:
        processor.descargar_audio("s1", {"key": "k"}, 1)
    assert exc.value.codigo == "audio_varias_cabeceras" and exc.value.definitivo
    asr.assert_not_called()


def test_los_cuatro_bytes_del_id_sueltos_en_el_audio_no_son_una_cabecera(mocker):
    # En ~120 MB de Opus la secuencia 1A 45 DF A3 aparece por azar: sin el
    # elemento EBMLVersion detras no es una cabecera y no se rechaza.
    archivo = CABECERA_CHROME + b"x" * 500 + bytes.fromhex("1a45dfa3") + b"y" * 500
    mocker.patch("processor.r2_client.descargar_audio", return_value=(archivo, {}))
    assert processor.cabeceras_ebml(archivo) == 1
    assert processor.descargar_audio("s1", {"key": "k"}, 1) == archivo


def test_transcribir_sin_segmentos_es_asr_vacio(mocker):
    mocker.patch("processor.asr_assemblyai.transcribir", return_value={"segments": []})
    with pytest.raises(PipelineError) as exc:
        processor.transcribir("s1", b"audio")
    assert exc.value.codigo == "asr_vacio" and exc.value.definitivo


def test_transcribir_pasa_los_terminos_y_no_los_loguea(mocker, caplog):
    asr = mocker.patch("processor.asr_assemblyai.transcribir", return_value=TRANSCRIPCION)
    with caplog.at_level(logging.DEBUG):
        processor.transcribir("s1", b"audio", ["NOMBRE-SECRETO", "GTFS"])
    # El ASR recibe un flujo binario con el audio, sin pasar por disco.
    assert asr.call_args.args[0].read() == b"audio"
    assert asr.call_args.args[1] == ["NOMBRE-SECRETO", "GTFS"]
    mensajes = [r.getMessage() for r in caplog.records]
    assert any("2 terminos ASR" in m for m in mensajes)
    assert all("NOMBRE-SECRETO" not in m for m in mensajes)


def test_el_checkpoint_invalido_es_definitivo():
    with pytest.raises(PipelineError) as exc:
        processor.desde_checkpoint({"transcripcion": "   "})
    assert exc.value.codigo == "checkpoint_invalido" and exc.value.definitivo


# Trabajos durables ─────────────────────────────────────────────────────────

def _borrar_trabajo(intentos):
    res = processor.ejecutar_trabajo(
        {"tipo": "borrar_transcript_asr", "payload": {"transcriptId": "tr1"}, "intentos": intentos}
    )
    res.pop("uso")
    return res


def test_borrar_transcript_asr_200_y_404_son_hecho(mocker):
    borrar = mocker.patch("processor.asr_assemblyai._borrar")
    listo = processor.primer_intento_que_borra()
    for status in (200, 404):
        borrar.return_value = status
        assert _borrar_trabajo(listo) == {"ok": True}
    borrar.assert_called_with("tr1")

    borrar.return_value = 500
    res = _borrar_trabajo(listo)
    assert res["ok"] is False and "500" in res["error"]

    borrar.return_value = None
    assert _borrar_trabajo(listo + 3)["ok"] is False


@pytest.mark.parametrize("intentos", [None, "3", 1, 2])
def test_borrar_transcript_asr_no_borra_mientras_el_worker_dueno_puede_estar_esperando(mocker, intentos):
    borrar = mocker.patch("processor.asr_assemblyai._borrar")
    assert _borrar_trabajo(intentos) == {"ok": False, "error": "esperando_al_worker_del_transcript"}
    borrar.assert_not_called()


def test_el_primer_intento_que_borra_llega_despues_del_timeout_del_polling():
    necesario = config.ASR_TIMEOUT_SECONDS + config.ASR_POLL_SECONDS + processor.asr_assemblyai.TIMEOUT_HTTP_SEG
    n = processor.primer_intento_que_borra()
    assert processor.espera_minima_antes_del_intento(n) >= necesario
    assert processor.espera_minima_antes_del_intento(n - 1) < necesario
    # Con la politica de hoy y 30 min de polling: el quinto intento (36 min
    # como minimo, aun si dos workers murieron con el trabajo en la mano).
    assert (n, processor.espera_minima_antes_del_intento(n)) == (5, 60 + 300 + 900 + 900)


def test_la_espera_minima_usa_el_lease_cuando_es_menor_que_el_backoff():
    assert processor.espera_minima_antes_del_intento(1) == 0
    assert processor.espera_minima_antes_del_intento(2) == 60
    assert processor.espera_minima_antes_del_intento(4) == 60 + 300 + 900


def test_con_un_polling_mas_largo_espera_mas_intentos(mocker):
    mocker.patch.object(config, "ASR_TIMEOUT_SECONDS", 3600)
    assert processor.primer_intento_que_borra() == 7


def test_borrar_transcript_asr_excepcion_solo_deja_el_tipo(mocker):
    mocker.patch("processor.asr_assemblyai._borrar", side_effect=RuntimeError("red caida"))
    res = _borrar_trabajo(processor.primer_intento_que_borra())
    assert res == {"ok": False, "error": "RuntimeError"}


def test_generar_feedback_usa_el_adjunto_y_devuelve_el_reporte(mocker):
    generar = mocker.patch(
        "processor.clinical_analyzer.generar_feedback_terapeuta",
        return_value=({"mitiCounts": {}}, "therapist_feedback_v1.1.md", _diag()),
    )
    res = processor.ejecutar_trabajo(
        {
            "tipo": "generar_feedback",
            "payload": {"sesionId": "s1", "pacienteId": "p1"},
            "adjunto": {"transcripcionFormateada": "[00:00] T: hola", "speechAnalytics": {"ratio": 1}, "orientacionTeorica": "gestalt"},
        }
    )
    assert "uso" in res
    del res["uso"]
    assert res == {"ok": True, "feedback": {"mitiCounts": {}}, "promptVersion": "therapist_feedback_v1.1.md", "modeloLlm": LLM}
    assert generar.call_args.args[0] == "[00:00] T: hola"
    assert generar.call_args.kwargs == {"speech_analytics": {"ratio": 1}, "orientacion": "gestalt", "llamadas": []}


def test_generar_feedback_sin_reporte_devuelve_el_motivo(mocker):
    mocker.patch(
        "processor.clinical_analyzer.generar_feedback_terapeuta",
        return_value=(None, "therapist_feedback_gestalt_v1.1.md", _diag(["feedback_no_generado: llm_truncado"])),
    )
    res = processor.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": {"transcripcionFormateada": "x"}})
    del res["uso"]
    assert res == {"ok": False, "error": "feedback_no_generado: llm_truncado"}

    assert processor.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": {}})["ok"] is False


def test_un_tipo_desconocido_no_lanza():
    res = processor.ejecutar_trabajo({"tipo": "desconocido"})
    assert res["ok"] is False and "desconocido" in res["error"]


# Logs y errores sin texto de la sesion ─────────────────────────────────────
#
# Una excepcion inesperada puede citar un valor sacado del contenido (una
# KeyError con una clave, un eco del proveedor). De esas solo viaja y se
# loguea el tipo; un PipelineError trae su codigo y su mensaje publico.

SECRETO = "ANA-SECRETA dijo que no duerme"


def test_una_excepcion_inesperada_en_un_trabajo_solo_deja_el_tipo(mocker, caplog):
    mocker.patch("processor.generar_feedback", side_effect=KeyError(SECRETO))
    with caplog.at_level(logging.DEBUG):
        res = processor.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": {}})
    assert res["error"] == "KeyError"
    assert all(SECRETO not in r.getMessage() for r in caplog.records)


def test_una_excepcion_inesperada_en_la_sesion_solo_loguea_el_tipo(pasos, caplog):
    pasos["mocker"].patch("processor.transcribir", side_effect=RuntimeError(SECRETO))
    with caplog.at_level(logging.DEBUG):
        processor.procesar_sesion(sesion())
    payload = pasos["resultado"].call_args.args[2]
    assert payload["codigo"] == "error_interno"
    assert any("error_interno RuntimeError" in r.getMessage() for r in caplog.records)
    assert all(SECRETO not in r.getMessage() for r in caplog.records)
    assert SECRETO not in str(payload)


def test_un_adjunto_de_recorrido_invalido_dice_por_que(mocker):
    res = processor.ejecutar_trabajo({"tipo": "integrar_contexto", "adjunto": {}, "payload": {}})
    assert res["ok"] is False
    assert res["error"] == "adjunto_invalido: Adjunto de Recorrido inválido"

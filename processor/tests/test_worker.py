"""
worker.py: la traduccion de los items de /pendientes y /trabajos/pendientes
a las llamadas de processor, el loop con sus senales y apagado ordenado, el
modo manual y main. Sin red.
"""
import json
import signal

import pytest
import requests

import worker
from app_client import RespuestaApp
from processor import SesionReclamada

ITEM = {
    "sesionClinicaId": "s1",
    "intento": 2,
    "ticket": "a" * 64,
    "pacienteId": "p1",
    "orientacionTeorica": "gestalt",
    "terminosAsr": ["GTFS", "   ", None, "MITI 4.2.1"],
    "duracionAudioSeg": 120,
    "audio": {"key": "org/s1/0"},
    "checkpoint": None,
}


def test_el_item_se_traduce_con_terminos_saneados():
    s = SesionReclamada.desde_item(ITEM)
    assert s is not None
    assert (s.sesion_clinica_id, s.intento, s.ticket) == ("s1", 2, "a" * 64)
    assert s.terminos_asr == ["GTFS", "MITI 4.2.1"]
    assert s.audio == ITEM["audio"] and s.checkpoint is None


def test_sin_ticket_o_sin_intento_el_item_se_ignora():
    assert SesionReclamada.desde_item({**ITEM, "ticket": None}) is None
    assert SesionReclamada.desde_item({**ITEM, "intento": "2"}) is None
    assert SesionReclamada.desde_item({**ITEM, "audio": None}) is None


def test_con_checkpoint_no_hace_falta_audio():
    s = SesionReclamada.desde_item({**ITEM, "audio": None, "checkpoint": {"transcripcion": "t", "modeloAsr": "m"}})
    assert s is not None and s.audio is None and s.checkpoint == {"transcripcion": "t", "modeloAsr": "m"}


def test_las_sesiones_llegan_a_procesar_sesion(mocker):
    procesar = mocker.patch("worker.procesar_sesion")

    worker._procesar_pendientes([ITEM, {"sesionClinicaId": "sin-ticket"}])

    assert procesar.call_count == 1
    sesion = procesar.call_args.args[0]
    assert sesion.sesion_clinica_id == "s1" and sesion.intento == 2


def test_los_trabajos_se_ejecutan_y_se_resuelven_con_su_ticket(mocker):
    ejecutar = mocker.patch("worker.processor.ejecutar_trabajo", return_value={"ok": True})
    resolver = mocker.patch("worker.app_client.resolver_trabajo", return_value=RespuestaApp(ok=True, status=200))

    worker._procesar_trabajos([{"trabajoId": "t1", "ticket": "b" * 64, "tipo": "borrar_transcript_asr"}, {"trabajoId": "t2"}])

    ejecutar.assert_called_once()
    resolver.assert_called_once_with("t1", "b" * 64, {"ok": True})


def test_el_ciclo_reclama_sesiones_y_despues_trabajos_de_los_tipos_soportados(mocker):
    pendientes = mocker.patch("worker.app_client.obtener_pendientes", return_value=[])
    trabajos = mocker.patch("worker.app_client.trabajos_pendientes", return_value=[])

    worker._ciclo()

    pendientes.assert_called_once()
    trabajos.assert_called_once_with(["borrar_transcript_asr", "generar_feedback", "integrar_contexto"])


# Loop, senales y apagado ordenado ──────────────────────────────────────────


@pytest.fixture(autouse=True)
def corriendo(mocker):
    """Cada test arranca con el worker corriendo; _running es global."""
    mocker.patch.object(worker, "_running", True)


@pytest.fixture
def senales(mocker):
    """signal.signal registra en un dict en vez de tocar el proceso de pytest."""
    registradas: dict = {}
    mocker.patch("worker.signal.signal", side_effect=lambda sig, h: registradas.__setitem__(sig, h))
    return registradas


def test_el_loop_sobrevive_a_un_ciclo_roto_y_para_con_sigterm_sin_dormir_de_mas(mocker, senales):
    dormir = mocker.patch("worker._dormir_interrumpible")
    ciclos: list[str] = []

    def ciclo():
        ciclos.append("ciclo")
        if len(ciclos) == 1:
            raise RuntimeError("algo inesperado")
        if len(ciclos) == 2:
            # Railway manda SIGTERM en medio del segundo ciclo.
            senales[signal.SIGTERM](signal.SIGTERM, None)

    mocker.patch("worker._ciclo", side_effect=ciclo)

    worker.loop_principal()

    assert set(senales) == {signal.SIGINT, signal.SIGTERM}
    assert ciclos == ["ciclo", "ciclo"]
    # Durmio despues del ciclo roto; despues de la senal, no.
    dormir.assert_called_once_with(worker.config.POLL_INTERVAL_SECONDS)
    assert worker._running is False


def test_la_primera_senal_pide_terminar_y_la_segunda_fuerza_la_salida():
    worker._signal_handler(signal.SIGTERM, None)
    assert worker._running is False

    with pytest.raises(SystemExit) as exc:
        worker._signal_handler(signal.SIGINT, None)
    assert exc.value.code == 1


def test_dormir_duerme_de_a_un_segundo_y_se_corta_con_la_senal(mocker):
    dormidas: list[int] = []

    def sleep(seg):
        dormidas.append(seg)
        if len(dormidas) == 3:
            worker._running = False

    mocker.patch("worker.time.sleep", side_effect=sleep)

    worker._dormir_interrumpible(30)

    assert dormidas == [1, 1, 1]


def test_dormir_cero_o_negativo_no_duerme(mocker):
    sleep = mocker.patch("worker.time.sleep")
    worker._dormir_interrumpible(0)
    worker._dormir_interrumpible(-5)
    sleep.assert_not_called()


def test_con_la_senal_no_se_toman_mas_sesiones_ni_trabajos(mocker):
    procesar = mocker.patch("worker.procesar_sesion")
    ejecutar = mocker.patch("worker.processor.ejecutar_trabajo")
    worker._running = False

    worker._procesar_pendientes([ITEM])
    worker._procesar_trabajos([{"trabajoId": "t1", "ticket": "b" * 64}])

    procesar.assert_not_called()
    ejecutar.assert_not_called()


def test_una_sesion_que_explota_no_corta_las_siguientes_ni_loguea_el_item(mocker, caplog):
    procesar = mocker.patch("worker.procesar_sesion", side_effect=[RuntimeError("x"), None])

    with caplog.at_level("WARNING"):
        worker._procesar_pendientes(["no-es-objeto", ITEM, {**ITEM, "sesionClinicaId": "s2"}])

    assert procesar.call_count == 2
    assert all("a" * 64 not in r.getMessage() for r in caplog.records)


def test_un_trabajo_que_la_app_no_acepta_solo_se_loguea(mocker, caplog):
    mocker.patch("worker.processor.ejecutar_trabajo", return_value={"ok": True})
    mocker.patch("worker.app_client.resolver_trabajo", return_value=RespuestaApp(ok=False, status=503))

    with caplog.at_level("WARNING"):
        worker._procesar_trabajos(["no-es-objeto", {"trabajoId": "t1", "ticket": "b" * 64}])

    assert any("t1" in r.getMessage() and "503" in r.getMessage() for r in caplog.records)


def test_si_no_se_pueden_reclamar_sesiones_el_ciclo_no_pide_trabajos(mocker):
    mocker.patch("worker.app_client.obtener_pendientes", side_effect=requests.ConnectionError())
    trabajos = mocker.patch("worker.app_client.trabajos_pendientes")

    worker._ciclo()

    trabajos.assert_not_called()


def test_el_ciclo_procesa_lo_que_hay_y_para_entre_sesiones_y_trabajos_con_la_senal(mocker):
    mocker.patch("worker.app_client.obtener_pendientes", return_value=[ITEM])
    trabajos = mocker.patch("worker.app_client.trabajos_pendientes", return_value=[{"trabajoId": "t1"}])
    procesar_trabajos = mocker.patch("worker._procesar_trabajos")

    def procesar(_items):
        worker._running = False

    mocker.patch("worker._procesar_pendientes", side_effect=procesar)

    worker._ciclo()

    trabajos.assert_not_called()
    procesar_trabajos.assert_not_called()


def test_el_ciclo_entrega_los_trabajos_y_tolera_que_falle_su_reclamo(mocker):
    mocker.patch("worker.app_client.obtener_pendientes", return_value=[])
    trabajos = mocker.patch("worker.app_client.trabajos_pendientes", return_value=[{"trabajoId": "t1"}])
    procesar_trabajos = mocker.patch("worker._procesar_trabajos")

    worker._ciclo()
    procesar_trabajos.assert_called_once_with([{"trabajoId": "t1"}])

    trabajos.side_effect = requests.Timeout()
    worker._ciclo()
    assert procesar_trabajos.call_count == 1


# Modo manual y main ────────────────────────────────────────────────────────

def test_modo_manual_procesa_el_item_del_archivo(mocker, tmp_path):
    procesar = mocker.patch("worker.procesar_sesion")
    ruta = tmp_path / "item.json"
    ruta.write_text(json.dumps(ITEM), encoding="utf-8")

    assert worker.procesar_modo_manual(str(ruta)) is True
    assert procesar.call_args.args[0].sesion_clinica_id == "s1"

    procesar.side_effect = RuntimeError("boom")
    assert worker.procesar_modo_manual(str(ruta)) is False


@pytest.mark.parametrize("contenido", [None, "{no es json", json.dumps({"sesionClinicaId": "s1"})])
def test_modo_manual_con_un_archivo_que_no_sirve_devuelve_false(mocker, tmp_path, contenido):
    procesar = mocker.patch("worker.procesar_sesion")
    ruta = tmp_path / "item.json"
    if contenido is not None:
        ruta.write_text(contenido, encoding="utf-8")

    assert worker.procesar_modo_manual(str(ruta)) is False
    procesar.assert_not_called()


@pytest.mark.parametrize(
    "argv, salida",
    [(["worker.py", "manual", "item.json"], 0), (["worker.py", "manual"], 1)],
)
def test_main_en_modo_manual_sale_con_el_resultado(mocker, argv, salida):
    validar = mocker.patch("worker.config.validar_config")
    mocker.patch("worker.procesar_modo_manual", return_value=True)
    loop = mocker.patch("worker.loop_principal")
    mocker.patch("worker.sys.argv", argv)

    with pytest.raises(SystemExit) as exc:
        worker.main()

    assert exc.value.code == salida
    validar.assert_called_once()
    loop.assert_not_called()


def test_main_sin_argumentos_valida_y_entra_al_loop(mocker):
    validar = mocker.patch("worker.config.validar_config")
    loop = mocker.patch("worker.loop_principal")
    mocker.patch("worker.sys.argv", ["worker.py"])

    worker.main()

    validar.assert_called_once()
    loop.assert_called_once()

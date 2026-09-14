"""
Traduccion de los items de /pendientes y /trabajos/pendientes a las llamadas
de processor. Sin red.
"""
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
    "audio": {"clave": "k", "segmentos": [{"indice": 0, "key": "org/s1/0", "iv": "iv0", "bytes": 10}]},
    "checkpoint": None,
}


def test_el_item_se_traduce_con_terminos_saneados():
    s = SesionReclamada.desde_item(ITEM)
    assert s is not None
    assert (s.sesion_clinica_id, s.intento, s.ticket) == ("s1", 2, "a" * 64)
    assert s.terminos_asr == ["GTFS", "MITI 4.2.1"]
    assert s.orientacion_teorica == "gestalt"
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
    trabajos.assert_called_once_with(["borrar_transcript_asr", "generar_feedback"])

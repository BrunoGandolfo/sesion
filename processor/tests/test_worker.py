"""
Armado de los argumentos de cada sesion pendiente. Sin red: solo la traduccion
del item de /pendientes a la llamada de procesar_sesion.
"""
import worker

ITEM = {
    "sesionClinicaId": "s1",
    "audioR2Key": "audio/org/s1/t1.enc",
    "claveCifrado": "clave",
    "iv": "iv",
    "pacienteId": "p1",
    "orientacionTeorica": "gestalt",
    "intento": 2,
}


def test_item_sin_terminos_asr_da_lista_vacia():
    # La app todavia no manda el campo: el worker procesa la sesion igual.
    args = worker._extraer_args(ITEM)
    assert args is not None
    assert args[-1] == []


def test_item_con_terminos_asr_los_arrastra_saneados():
    item = {**ITEM, "terminosAsr": ["GTFS", "   ", None, "MITI 4.2.1"]}
    assert worker._extraer_args(item)[-1] == ["GTFS", "MITI 4.2.1"]


def test_falta_un_campo_obligatorio_y_el_item_se_ignora():
    assert worker._extraer_args({**ITEM, "audioR2Key": None}) is None


def test_los_terminos_llegan_hasta_procesar_sesion(mocker):
    procesar = mocker.patch("worker.procesar_sesion")

    worker._procesar_pendientes([{**ITEM, "terminosAsr": ["GTFS"]}])

    assert procesar.call_args.kwargs["terminos_asr"] == ["GTFS"]
    assert procesar.call_args.kwargs["sesion_clinica_id"] == "s1"
    assert procesar.call_args.kwargs["orientacion_teorica"] == "gestalt"
    assert procesar.call_args.kwargs["intento"] == 2


def test_sin_el_campo_procesar_sesion_recibe_lista_vacia(mocker):
    procesar = mocker.patch("worker.procesar_sesion")

    worker._procesar_pendientes([ITEM])

    assert procesar.call_args.kwargs["terminos_asr"] == []

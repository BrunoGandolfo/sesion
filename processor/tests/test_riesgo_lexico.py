import pytest

import processor
from clinical_analyzer import DiagnosticoLLM
from riesgo_lexico import buscar_menciones, TERMINOS, VERSION


@pytest.mark.parametrize("termino", TERMINOS)
def test_cita_literal_con_timestamp_y_version_sin_evaluacion(termino):
    frase = f"[12:34] Paciente: Me preocupó decir {termino.upper()}."
    r = buscar_menciones(frase)
    assert r == {"version": VERSION, "coincidencias": [{"termino": termino, "timestamp": "12:34", "quote": frase}]}
    assert "nivel" not in r


def test_no_clasifica_negaciones_ni_fragmentos_de_otra_palabra():
    r = buscar_menciones("[00:10] S0: No quiero matarme.\n[00:20] S1: Descartarme no es cortarmejor.")
    assert len(r["coincidencias"]) == 1
    assert "No quiero matarme" in r["coincidencias"][0]["quote"]
    assert buscar_menciones("Hablamos de su semana")["coincidencias"] == []


def test_no_une_palabras_de_distintas_intervenciones():
    assert buscar_menciones("[00:00] S0: quitarme\n[00:01] S1: la vida")["coincidencias"] == []


def test_el_pipeline_envia_menciones_aunque_el_modelo_no_gradue_riesgo(mocker):
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    mocker.patch("processor.clinical_analyzer.analizar", return_value=(
        {"nota": {"subjetivo": "S", "objetivo": "O", "analisis": "A", "plan": "P"}, "datosEstructurados": {}},
        "nota", DiagnosticoLLM(0, []),
    ))
    r = processor.analizar("s1", processor.Transcripto("[00:10] S0: No quiero vivir", {}, "asr"), "p1", "ticket")
    assert r.datos_estructurados["riesgoLexico"]["coincidencias"][0]["termino"] == "no quiero vivir"
    assert "riesgoDetectado" not in r.datos_estructurados

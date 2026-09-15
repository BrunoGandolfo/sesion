import copy
import json

import pytest
import requests

import app_client
import processor
from schemas_llm import validar_estructura_contexto


def contenido():
    return {
        "hipotesisDiagnostica": None, "resumenAcumulativo": "Resumen aprobado",
        "objetivosTerapeuticos": [], "intervencionesProbadas": [],
        "temasRecurrentes": [], "riesgosHistoricos": [], "cambios": [],
    }


def trabajo():
    return {"tipo": "integrar_contexto", "payload": {"sesionId": "s1", "pacienteId": "p1", "basadaEnVersion": 1}, "adjunto": {
        "tipo": "integrar_contexto", "sesionId": "s1", "pacienteId": "p1", "version": 1,
        "contextoVigente": contenido(), "notaFinal": dict.fromkeys(["subjetivo", "objetivo", "analisis", "plan"], "nota"),
        "datos": {"riesgoLexico": {"coincidencias": ["frase"]}}, "fechaSesion": "2026-09-01",
    }}


def test_integrar_contexto_produce_propuesta_sin_escribir_el_vigente(mocker):
    llamar = mocker.patch("processor.clinical_analyzer.actualizar_contexto_clinico", return_value=(contenido(), "update_context_v2.1.md"))
    resultado = processor.ejecutar_trabajo(trabajo())
    assert resultado["ok"] is True
    assert resultado["propuesta"] == contenido()
    assert resultado["promptVersion"] == "update_context_v2.1.md"
    assert llamar.call_args.args[0] == contenido()
    assert "riesgoLexico" not in llamar.call_args.args[2]
    assert llamar.call_args.args[4:] == ("2026-09-01",)


@pytest.mark.parametrize("campo,valor", [("tipo", "login"), ("sesionId", "otra"), ("pacienteId", "otra"), ("version", 2), ("contextoVigente", {}), ("notaFinal", "html"), ("fechaSesion", "2026-02-30")])
def test_adjunto_invalido_nunca_llega_al_proveedor(mocker, campo, valor):
    llamar = mocker.patch("processor.clinical_analyzer.actualizar_contexto_clinico")
    t = trabajo()
    t["adjunto"][campo] = valor
    assert processor.ejecutar_trabajo(t)["ok"] is False
    llamar.assert_not_called()


@pytest.mark.parametrize("campo,valor", [
    ("temasRecurrentes", [{"tema": "ansiedad", "conteo": True}]),
    ("temasRecurrentes", [{"tema": "ansiedad", "conteo": 0}]),
    ("intervencionesProbadas", [{"tecnica": "inventada", "eficaciaPercibida": "alta", "sesiones": [1]}]),
    ("objetivosTerapeuticos", [{"id": "o", "descripcion": "d", "estado": "activo", "fechaInicio": "2026-02-30", "fechaCierre": None}]),
    ("riesgosHistoricos", ["riesgo"]), ("cambios", [""]),
])
def test_contexto_valida_tambien_las_estructuras_anidadas(campo, valor):
    c = contenido()
    c[campo] = valor
    with pytest.raises(ValueError):
        validar_estructura_contexto(c)


def test_contexto_valido_se_serializa_solo_despues_de_validar(mocker):
    r = mocker.Mock(status_code=200, headers={"Content-Type": "application/json"})
    r.json.return_value = {"data": {"tipo": "hilo_vigente", "pacienteId": "p1", "version": 1, "contenido": contenido()}}
    mocker.patch("app_client.requests.get", return_value=r)
    assert json.loads(app_client.obtener_contexto_clinico_llm("p1", "s1", "ticket")) == contenido()
    roto = copy.deepcopy(r.json.return_value)
    roto["data"]["contenido"]["temasRecurrentes"] = [{"tema": "x", "conteo": "1"}]
    r.json.return_value = roto
    with pytest.raises(requests.RequestException):
        app_client.obtener_contexto_clinico_llm("p1", "s1", "ticket")


def test_fallo_de_contexto_impide_generar_una_nota_sin_historia(mocker):
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", side_effect=requests.RequestException())
    llamar = mocker.patch("processor.clinical_analyzer.analizar")
    with pytest.raises(processor.PipelineError, match="Recorrido"):
        processor.analizar("s1", processor.Transcripto("texto", {}, "asr"), "p1", "ticket")
    llamar.assert_not_called()


def test_referencias_de_sesion_son_identificadores_no_numeros_recalculados():
    c = contenido()
    ids = ["66f3c9b0-0da0-4d5e-a683-705a0e82cba3", "bd963db3-e413-4a52-aeaf-d68d973266aa"]
    c["intervencionesProbadas"] = [{"tecnica": "validacion", "eficaciaPercibida": "media", "sesiones": ids}]
    validar_estructura_contexto(c)
    c["intervencionesProbadas"][0]["sesiones"] = [1, 2]
    with pytest.raises(ValueError):
        validar_estructura_contexto(c)


def test_error_de_fecha_no_filtra_el_valor_clinico():
    secreto = "ANA-SECRETA"
    c = contenido()
    c["objetivosTerapeuticos"] = [{"id": "o", "descripcion": "objetivo", "estado": "activo", "fechaInicio": secreto, "fechaCierre": None}]
    with pytest.raises(ValueError) as e:
        validar_estructura_contexto(c)
    assert secreto not in str(e.value)
    t = trabajo()
    t["adjunto"]["fechaSesion"] = secreto
    assert secreto not in processor.ejecutar_trabajo(t)["error"]

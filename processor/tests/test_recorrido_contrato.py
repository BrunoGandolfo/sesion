"""
El worker no valida la forma ni los límites del Recorrido: eso es de la app
(contenidoHiloSchema, src/lib/hilo/contenido.ts). Lo único que exige es que
exista y sea un objeto JSON.

Los casos de contrato/recorridos-que-la-app-acepta.json son contenidos que
Zod acepta. Ninguno puede rechazarse en ninguno de los tres lugares donde el
worker recibe un Recorrido: la lectura para la nota, el adjunto del trabajo
integrar_contexto y la propuesta que devuelve el modelo.
"""
import json
from pathlib import Path

import pytest

import app_client
import clinical_analyzer
import trabajos
from schemas_llm import validar_recorrido

RUTA_CASOS = Path(__file__).resolve().parent.parent / "contrato" / "recorridos-que-la-app-acepta.json"
CASOS = json.loads(RUTA_CASOS.read_text(encoding="utf-8"))["casos"]
IDS = [c["nombre"] for c in CASOS]


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_lo_que_la_app_acepta_no_se_rechaza(caso):
    validar_recorrido(caso["contenido"])


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_la_lectura_para_la_nota_lo_acepta(mocker, caso):
    r = mocker.Mock(status_code=200, headers={"Content-Type": "application/json"})
    r.json.return_value = {"data": {"tipo": "hilo_vigente", "pacienteId": "p1", "version": 1, "contenido": caso["contenido"]}}
    mocker.patch("app_client.requests.get", return_value=r)
    assert json.loads(app_client.obtener_contexto_clinico_llm("p1", "s1", "ticket")) == caso["contenido"]


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_el_adjunto_de_integrar_contexto_lo_acepta(mocker, caso):
    mocker.patch("trabajos.clinical_analyzer.actualizar_contexto_clinico", return_value=(caso["contenido"], "update_context_v2.1.md"))
    trabajo = {"tipo": "integrar_contexto", "payload": {"sesionId": "s1", "pacienteId": "p1", "basadaEnVersion": 1}, "adjunto": {
        "tipo": "integrar_contexto", "sesionId": "s1", "pacienteId": "p1", "version": 1,
        "contextoVigente": caso["contenido"], "notaFinal": dict.fromkeys(["subjetivo", "objetivo", "analisis", "plan"], "nota"),
        "datos": {}, "fechaSesion": "2026-09-01",
    }}
    assert trabajos.ejecutar_trabajo(trabajo)["ok"] is True


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_la_propuesta_del_modelo_no_se_reintenta_ni_se_rechaza(mocker, caso):
    llamar = mocker.patch("clinical_analyzer._llamar_anthropic", return_value=caso["contenido"])
    propuesta, _ = clinical_analyzer.actualizar_contexto_clinico({}, {"subjetivo": "s"}, {}, "s1", "2026-09-01")
    assert propuesta == caso["contenido"]
    assert llamar.call_count == 1


@pytest.mark.parametrize("valor", [None, [], "texto", 3])
def test_lo_unico_que_se_exige_es_un_objeto_json(valor):
    with pytest.raises(ValueError):
        validar_recorrido(valor)

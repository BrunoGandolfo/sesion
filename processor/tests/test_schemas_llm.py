"""
Schemas de structured outputs, parseo de la respuesta de Anthropic y las dos
capas de control sobre la salida del LLM:

  - validar_estructura_*  bloqueante (dispara el reintento y, si falla dos
                          veces, la sesion)
  - sanear_*              no bloqueante (anula el campo y deja advertencia)

Sin red: el cliente de Anthropic se reemplaza por un mock.
"""
import json
from types import SimpleNamespace

import pytest

import clinical_analyzer
from errores import PipelineError
from schemas_llm import (
    ALIANZAS,
    SCHEMA_NOTA,
    TIPOS_INTERVENCION,
    sanear_datos_nota,
    sanear_feedback,
    validar_estructura_contexto,
    validar_estructura_feedback_cbt_mi,
    validar_estructura_feedback_gestalt,
    validar_estructura_nota,
)

# Mismo enum que tipoIntervencionSchema en src/lib/sesion-clinica/schema.ts.
TIPOS_INTERVENCION_APP = (
    "reformulacion",
    "senalamiento",
    "confrontacion",
    "interpretacion",
    "pregunta_circular",
    "validacion",
    "silencio_terapeutico",
    "otra",
)

RIESGO_SIN_SEÑAL = {
    "nivel": "ninguno",
    "indicadores": [],
    "evidencia": [],
    "notaParaTerapeuta": None,
}


def _nota(**datos) -> dict:
    """Nota estructuralmente valida; `datos` pisa datosEstructurados."""
    base = {
        "intensidadEmocional": 7,
        "alianzaTerapeutica": "estable",
        "duracionRealMin": 50,
        "riesgoDetectado": dict(RIESGO_SIN_SEÑAL),
    }
    base.update(datos)
    return {
        "nota": {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
        "datosEstructurados": base,
    }


def _respuesta(texto: str, stop_reason: str = "end_turn"):
    return SimpleNamespace(
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="text", text=texto)],
    )


def _mockear_cliente(mocker, respuesta):
    cliente = mocker.Mock()
    cliente.messages.create.return_value = respuesta
    mocker.patch("clinical_analyzer._cliente", return_value=cliente)
    return cliente


# Parseo de la respuesta ────────────────────────────────────────────────────

def test_parsea_json_valido(mocker):
    esperado = _nota()
    _mockear_cliente(mocker, _respuesta(json.dumps(esperado)))
    assert clinical_analyzer._llamar_anthropic("sys", "user", SCHEMA_NOTA) == esperado


def test_texto_antes_del_json_es_llm_json_invalido(mocker):
    # Un modelo que "razona" antes del JSON rompe json.loads: se reporta como
    # llm_json_invalido sin volcar el texto en la excepcion.
    texto = "Claro, aca va la nota:\n" + json.dumps(_nota())
    _mockear_cliente(mocker, _respuesta(texto))
    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_anthropic("sys", "user", SCHEMA_NOTA)
    assert exc.value.codigo == "llm_json_invalido"
    assert "Claro" not in str(exc.value)


def test_respuesta_truncada_es_llm_truncado(mocker):
    _mockear_cliente(mocker, _respuesta("{", stop_reason="max_tokens"))
    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_anthropic("sys", "user", SCHEMA_NOTA)
    assert exc.value.codigo == "llm_truncado"


def test_sin_bloque_de_texto_es_llm_sin_texto(mocker):
    respuesta = _respuesta("ignorado")
    respuesta.content = [SimpleNamespace(type="tool_use", text=None)]
    _mockear_cliente(mocker, respuesta)
    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_anthropic("sys", "user", SCHEMA_NOTA)
    assert exc.value.codigo == "llm_sin_texto"


# Escalas de valoracion: null aceptado ──────────────────────────────────────

@pytest.mark.parametrize(
    "campo", ["intensidadEmocional", "alianzaTerapeutica", "duracionRealMin"]
)
def test_null_se_acepta_sin_advertencia_y_sale_la_clave(campo):
    # El modelo dice "no pude evaluarlo". No es un error: la clave se omite
    # porque la app la declara opcional, no nullable
    # (src/lib/sesion-clinica/schema.ts:125,126,143).
    resultado = _nota(**{campo: None})

    advertencias = sanear_datos_nota(resultado)

    assert advertencias == []
    assert campo not in resultado["datosEstructurados"]


def test_null_en_las_tres_escalas_a_la_vez():
    resultado = _nota(
        intensidadEmocional=None, alianzaTerapeutica=None, duracionRealMin=None
    )

    assert sanear_datos_nota(resultado) == []
    assert set(resultado["datosEstructurados"]) == {"riesgoDetectado"}
    # La nota clinica no se toca.
    validar_estructura_nota(resultado)


def test_valores_validos_no_se_tocan():
    resultado = _nota(intensidadEmocional=1, duracionRealMin=0)
    assert sanear_datos_nota(resultado) == []
    assert resultado["datosEstructurados"]["intensidadEmocional"] == 1
    assert resultado["datosEstructurados"]["duracionRealMin"] == 0


# Escalas fuera de rango: se anulan, no tiran la sesion ─────────────────────

def test_intensidad_cero_se_anula_con_advertencia_y_la_sesion_sigue():
    """El caso del 4/9 (sesion cmtn88z280008mn6hl7zm32s7)."""
    resultado = _nota(intensidadEmocional=0)

    advertencias = sanear_datos_nota(resultado)

    assert advertencias == ["intensidadEmocional=0 fuera de rango 1..10, anulado"]
    assert "intensidadEmocional" not in resultado["datosEstructurados"]
    # Lo importante: la nota entera sobrevive.
    validar_estructura_nota(resultado)
    assert resultado["nota"]["analisis"] == "a"
    assert resultado["datosEstructurados"]["riesgoDetectado"] == RIESGO_SIN_SEÑAL


@pytest.mark.parametrize("intensidad", [0, 11, -3, 7.5, True, "7"])
def test_intensidad_invalida_se_anula_sin_lanzar(intensidad):
    resultado = _nota(intensidadEmocional=intensidad)

    advertencias = sanear_datos_nota(resultado)

    assert len(advertencias) == 1
    assert advertencias[0].startswith("intensidadEmocional=")
    assert "intensidadEmocional" not in resultado["datosEstructurados"]


@pytest.mark.parametrize("duracion", [-1, 2.5, "50", True])
def test_duracion_invalida_se_anula_sin_lanzar(duracion):
    resultado = _nota(duracionRealMin=duracion)

    advertencias = sanear_datos_nota(resultado)

    assert len(advertencias) == 1
    assert advertencias[0].startswith("duracionRealMin=")
    assert "duracionRealMin" not in resultado["datosEstructurados"]


def test_alianza_fuera_del_enum_se_anula_sin_eco_del_valor():
    resultado = _nota(alianzaTerapeutica="rota")

    advertencias = sanear_datos_nota(resultado)

    assert advertencias == ["alianzaTerapeutica fuera del enum, anulado"]
    assert "alianzaTerapeutica" not in resultado["datosEstructurados"]
    # El valor rechazado no se copia a la advertencia: viene del modelo.
    assert "rota" not in advertencias[0]


def test_varias_escalas_invalidas_dejan_una_advertencia_cada_una():
    resultado = _nota(intensidadEmocional=0, duracionRealMin=-5, alianzaTerapeutica="x")

    advertencias = sanear_datos_nota(resultado)

    assert len(advertencias) == 3
    assert resultado["nota"]["subjetivo"] == "s"


def test_sanear_sin_datos_estructurados_no_lanza():
    assert sanear_datos_nota({"nota": {}}) == []


# Estructura: lo que si es bloqueante ───────────────────────────────────────

def test_nota_completa_valida():
    validar_estructura_nota(_nota())


@pytest.mark.parametrize("seccion", ["subjetivo", "objetivo", "analisis", "plan"])
def test_falta_una_seccion_soap_es_bloqueante(seccion):
    resultado = _nota()
    del resultado["nota"][seccion]

    with pytest.raises(ValueError) as exc:
        validar_estructura_nota(resultado)
    assert seccion in str(exc.value)


@pytest.mark.parametrize("seccion", ["subjetivo", "plan"])
def test_seccion_soap_vacia_es_bloqueante(seccion):
    resultado = _nota()
    resultado["nota"][seccion] = "   "

    with pytest.raises(ValueError) as exc:
        validar_estructura_nota(resultado)
    assert seccion in str(exc.value)


def test_datos_estructurados_ausente_es_bloqueante():
    with pytest.raises(ValueError):
        validar_estructura_nota({"nota": {}})


def test_respuesta_que_no_es_objeto_es_bloqueante():
    with pytest.raises(ValueError):
        validar_estructura_nota(["no", "es", "un", "objeto"])


@pytest.mark.parametrize(
    "riesgo",
    [
        {"nivel": "altisimo", "indicadores": [], "evidencia": [], "notaParaTerapeuta": None},
        {"nivel": "alto", "indicadores": "ideacion", "evidencia": [], "notaParaTerapeuta": None},
        {"nivel": "alto", "indicadores": [], "evidencia": {}, "notaParaTerapeuta": None},
        {"nivel": "alto", "indicadores": [], "evidencia": [{"quote": "x"}], "notaParaTerapeuta": None},
        {"nivel": "alto", "indicadores": [], "evidencia": [], "notaParaTerapeuta": 7},
        "no es un objeto",
    ],
)
def test_riesgo_mal_formado_es_bloqueante(riesgo):
    # Una señal de riesgo rota no se descarta en silencio: se le pide al
    # modelo de nuevo y, si insiste, la sesion falla.
    with pytest.raises(ValueError) as exc:
        validar_estructura_nota(_nota(riesgoDetectado=riesgo))
    assert "riesgoDetectado" in str(exc.value)


def test_riesgo_bien_formado_con_señal_pasa():
    validar_estructura_nota(
        _nota(
            riesgoDetectado={
                "nivel": "moderado",
                "indicadores": ["ideacion suicida pasiva"],
                "evidencia": [{"timestamp": "01:09", "quote": "cita"}],
                "notaParaTerapeuta": "Observar el descanso.",
            }
        )
    )


def test_los_mensajes_de_validacion_no_llevan_contenido_clinico():
    # Se le citan al modelo en el reintento: solo nombres de campo y tipos.
    resultado = _nota()
    resultado["nota"]["analisis"] = ""
    with pytest.raises(ValueError) as exc:
        validar_estructura_nota(resultado)
    mensaje = str(exc.value)
    assert "analisis" in mensaje
    for texto_clinico in ("s", "o", "p"):
        assert f'"{texto_clinico}"' not in mensaje


# Estructura de feedback y contexto ─────────────────────────────────────────

def test_feedback_cbt_mi_incompleto_es_bloqueante():
    with pytest.raises(ValueError) as exc:
        validar_estructura_feedback_cbt_mi({"mitiGlobales": {}})
    assert "mitiCounts" in str(exc.value)


def test_feedback_gestalt_sin_items_es_bloqueante():
    with pytest.raises(ValueError) as exc:
        validar_estructura_feedback_gestalt({
            "instrumento": "gestalt",
            "itemsGTFS": [],
            "fortalezas": [],
            "areasCrecimiento": [],
        })
    assert "itemsGTFS" in str(exc.value)


def test_contexto_incompleto_es_bloqueante():
    with pytest.raises(ValueError) as exc:
        validar_estructura_contexto({"hipotesisDiagnostica": None})
    assert "resumenAcumulativo" in str(exc.value)


# Saneo de los puntajes por item del feedback ───────────────────────────────

def test_gestalt_score_fuera_de_escala_queda_en_null():
    feedback = {
        "itemsGTFS": [
            {"id": "gtfs_01", "score": 1},
            {"id": "gtfs_02", "score": 5},
            {"id": "gtfs_03", "score": None},
        ]
    }

    advertencias = sanear_feedback(feedback, "gestalt")

    assert len(advertencias) == 1
    assert feedback["itemsGTFS"][1]["score"] is None
    # Los validos y los null explicitos no se tocan.
    assert feedback["itemsGTFS"][0]["score"] == 1
    assert feedback["itemsGTFS"][2]["score"] is None


def test_miti_global_en_cero_queda_en_null_y_ctsr_en_cero_se_respeta():
    # MITI global es escala 1-5: el 0 no existe. CTS-R es 0-6: el 0 significa
    # "no realizado" y es un juicio legitimo.
    feedback = {
        "mitiGlobales": {"empathy": {"score": 0}},
        "ctsrSubset": {"agendaSetting": {"score": 0}},
    }

    advertencias = sanear_feedback(feedback, "cbt_mi")

    assert advertencias == ["mitiGlobales.empathy.score=0 fuera de rango 1..5, anulado"]
    assert feedback["mitiGlobales"]["empathy"]["score"] is None
    assert feedback["ctsrSubset"]["agendaSetting"]["score"] == 0


def test_sanear_feedback_tolera_formas_inesperadas():
    assert sanear_feedback({}, "cbt_mi") == []
    assert sanear_feedback({"itemsGTFS": "x"}, "gestalt") == []
    assert sanear_feedback(None, "cbt_mi") == []


# Enums y nullability del schema ────────────────────────────────────────────

def _props_datos() -> dict:
    return SCHEMA_NOTA["properties"]["datosEstructurados"]["properties"]


def test_enum_tipos_intervencion_coincide_con_la_app():
    assert TIPOS_INTERVENCION == TIPOS_INTERVENCION_APP
    enum = _props_datos()["intervenciones"]["items"]["properties"]["tipo"]["enum"]
    assert tuple(enum) == TIPOS_INTERVENCION_APP
    assert "psicoeducacion" not in enum


def test_las_tres_escalas_admiten_null_en_el_schema():
    # Structured outputs exige toda propiedad en `required`: sin nullable, el
    # modelo no tiene forma de decir "no lo pude evaluar" salvo inventando.
    assert _props_datos()["intensidadEmocional"]["type"] == ["integer", "null"]
    assert _props_datos()["duracionRealMin"]["type"] == ["integer", "null"]
    # Anthropic rechaza `{"type": ["string","null"], "enum": [..., null]}`
    # (verificado en produccion el 4/9/2026); la forma aceptada es anyOf.
    alianza = _props_datos()["alianzaTerapeutica"]
    assert alianza["anyOf"] == [
        {"type": "string", "enum": list(ALIANZAS)},
        {"type": "null"},
    ]


def test_enum_alianza_y_riesgo_siguen_cerrados():
    enum_alianza = _props_datos()["alianzaTerapeutica"]["anyOf"][0]["enum"]
    assert enum_alianza == ["fragil", "inestable", "estable", "fuerte"]
    # El nivel de riesgo NO admite null: la ausencia de señal se dice
    # con "ninguno", que es informacion clinica afirmativa.
    nivel = _props_datos()["riesgoDetectado"]["properties"]["nivel"]
    assert nivel["type"] == "string"
    assert nivel["enum"] == ["ninguno", "bajo", "moderado", "alto"]
    assert "rota" not in enum_alianza


def test_todo_objeto_prohibe_propiedades_extra():
    def recorrer(schema: dict):
        if schema.get("type") == "object":
            assert schema["additionalProperties"] is False
            assert set(schema["required"]) == set(schema["properties"])
            for sub in schema["properties"].values():
                recorrer(sub)
        if schema.get("type") == "array":
            recorrer(schema["items"])

    recorrer(SCHEMA_NOTA)

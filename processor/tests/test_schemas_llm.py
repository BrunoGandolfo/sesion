"""
Schemas de structured outputs y parseo de la respuesta de Anthropic.
Sin red: el cliente de Anthropic se reemplaza por un mock.
"""
import json
from types import SimpleNamespace

import pytest

import clinical_analyzer
from errores import PipelineError
from schemas_llm import SCHEMA_NOTA, TIPOS_INTERVENCION, validar_rangos_nota

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


def _nota(intensidad=7, duracion=50) -> dict:
    return {
        "nota": {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
        "datosEstructurados": {
            "intensidadEmocional": intensidad,
            "duracionRealMin": duracion,
        },
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


# Rangos que el schema no expresa ───────────────────────────────────────────

def test_rangos_validos_no_lanzan():
    validar_rangos_nota(_nota(intensidad=1, duracion=0))
    validar_rangos_nota(_nota(intensidad=10, duracion=90))


@pytest.mark.parametrize("intensidad", [0, 11, -3, 7.5, True, "7"])
def test_intensidad_fuera_de_rango_o_tipo(intensidad):
    with pytest.raises(ValueError):
        validar_rangos_nota(_nota(intensidad=intensidad))


@pytest.mark.parametrize("duracion", [-1, 2.5, None])
def test_duracion_invalida(duracion):
    with pytest.raises(ValueError):
        validar_rangos_nota(_nota(duracion=duracion))


def test_datos_estructurados_ausente():
    with pytest.raises(ValueError):
        validar_rangos_nota({"nota": {}})


# Enums fijos en el schema (los hace cumplir Anthropic) ─────────────────────

def _props_datos() -> dict:
    return SCHEMA_NOTA["properties"]["datosEstructurados"]["properties"]


def test_enum_tipos_intervencion_coincide_con_la_app():
    assert TIPOS_INTERVENCION == TIPOS_INTERVENCION_APP
    enum = _props_datos()["intervenciones"]["items"]["properties"]["tipo"]["enum"]
    assert tuple(enum) == TIPOS_INTERVENCION_APP
    assert "psicoeducacion" not in enum


def test_enum_alianza_y_riesgo_son_cerrados():
    assert _props_datos()["alianzaTerapeutica"]["enum"] == [
        "fragil", "inestable", "estable", "fuerte",
    ]
    assert _props_datos()["riesgoDetectado"]["properties"]["nivel"]["enum"] == [
        "ninguno", "bajo", "moderado", "alto",
    ]
    assert "rota" not in _props_datos()["alianzaTerapeutica"]["enum"]


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

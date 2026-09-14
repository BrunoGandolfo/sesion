"""
El contrato de enums clínicos compartido con la app: contrato/enums-clinicos.json.

Lo que se prueba acá es que el worker LEE ese archivo y que sus constantes son
exactamente lo que el archivo dice. No hay una segunda copia de los valores en
este test: la comparación es contra el JSON crudo. Si la app cambia un enum
(cambia el JSON), estas constantes cambian con él; si el JSON queda mal
formado, el módulo no importa y esta suite entera se cae, que es la idea.
"""
import json
import shutil
from pathlib import Path

import pytest

import schemas_llm
from schemas_llm import (
    ALIANZAS,
    CLAVES_CONTRATO,
    CONFIANZAS_MODELO,
    FLAGS_RIESGO,
    NIVELES_RIESGO,
    RUTA_CONTRATO,
    SCHEMA_CONTEXTO,
    SCHEMA_NOTA,
    TIPOS_INTERVENCION,
    cargar_enums_clinicos,
)


def _json():
    with open(RUTA_CONTRATO, encoding="utf-8") as f:
        return json.load(f)


def test_el_contrato_vive_bajo_processor_y_tiene_las_cinco_claves():
    # Railway despliega el worker con rootDirectory=/processor: un archivo
    # fuera de esa carpeta no existiría en producción.
    assert RUTA_CONTRATO.is_relative_to(Path(schemas_llm.__file__).resolve().parent)
    crudo = _json()
    assert set(CLAVES_CONTRATO) <= set(crudo)
    for clave in CLAVES_CONTRATO:
        valores = crudo[clave]
        assert valores and all(isinstance(v, str) and v for v in valores)
        assert len(set(valores)) == len(valores), f"{clave} repite valores"


def test_las_constantes_del_modulo_son_el_json():
    crudo = _json()
    assert TIPOS_INTERVENCION == tuple(crudo["tipoIntervencion"])
    assert FLAGS_RIESGO == tuple(crudo["flagRiesgo"])
    assert NIVELES_RIESGO == tuple(crudo["nivelRiesgo"])
    assert ALIANZAS == tuple(crudo["alianzaTerapeutica"])
    assert CONFIANZAS_MODELO == tuple(crudo["confianzaModelo"])


def test_los_schemas_de_structured_outputs_usan_los_enums_del_contrato():
    datos = SCHEMA_NOTA["properties"]["datosEstructurados"]["properties"]
    assert tuple(datos["intervenciones"]["items"]["properties"]["tipo"]["enum"]) == TIPOS_INTERVENCION
    assert tuple(datos["riesgoDetectado"]["properties"]["nivel"]["enum"]) == NIVELES_RIESGO
    assert tuple(datos["confianzaModelo"]["enum"]) == CONFIANZAS_MODELO
    alianza = datos["alianzaTerapeutica"]["anyOf"][0]["enum"]
    assert tuple(alianza) == ALIANZAS
    # Las flags son las claves del objeto flagsRiesgo, más el detalle.
    assert set(datos["flagsRiesgo"]["properties"]) == set(FLAGS_RIESGO) | {"detalle"}

    riesgos = SCHEMA_CONTEXTO["properties"]["riesgosHistoricos"]["items"]["properties"]
    assert tuple(riesgos["flag"]["enum"]) == FLAGS_RIESGO


def test_un_contrato_roto_no_se_carga_en_silencio(tmp_path):
    roto = tmp_path / "enums-clinicos.json"
    shutil.copy(RUTA_CONTRATO, roto)
    crudo = _json()
    crudo["nivelRiesgo"] = []
    roto.write_text(json.dumps(crudo), encoding="utf-8")
    with pytest.raises(ValueError, match="nivelRiesgo"):
        cargar_enums_clinicos(roto)

    crudo = _json()
    del crudo["flagRiesgo"]
    roto.write_text(json.dumps(crudo), encoding="utf-8")
    with pytest.raises(ValueError, match="flagRiesgo"):
        cargar_enums_clinicos(roto)

    crudo = _json()
    crudo["tipoIntervencion"].append(crudo["tipoIntervencion"][0])
    roto.write_text(json.dumps(crudo), encoding="utf-8")
    with pytest.raises(ValueError, match="repetidos"):
        cargar_enums_clinicos(roto)

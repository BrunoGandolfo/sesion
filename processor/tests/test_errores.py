"""Clasificacion transitorio / definitivo de los fallos del pipeline."""
from errores import CODIGOS_DEFINITIVOS, PipelineError


def test_los_codigos_de_la_lista_son_definitivos_y_el_resto_transitorio():
    for codigo in CODIGOS_DEFINITIVOS:
        assert PipelineError(codigo, "x").definitivo is True
    for codigo in ("r2_error", "asr_error", "asr_timeout", "llm_timeout", "llm_error", "app_error", "error_interno"):
        assert PipelineError(codigo, "x").definitivo is False


def test_las_salidas_del_modelo_que_no_se_arreglan_solas_son_definitivas():
    # Llegan despues del reintento de forma, o no se reintentan (rechazo, sin
    # texto): repetir la sesion paga lo mismo y da lo mismo.
    for codigo in ("llm_truncado", "llm_json_invalido", "llm_estructura_invalida", "llm_rechazo", "llm_sin_texto"):
        assert codigo in CODIGOS_DEFINITIVOS


def test_cada_codigo_definitivo_tiene_quien_lo_emita():
    # Un codigo que nadie produce (como era llm_invalido) no decide nada.
    import pathlib
    import re

    # errores.py queda afuera: ahi solo se declaran.
    fuentes = "".join(
        p.read_text(encoding="utf-8")
        for p in pathlib.Path(__file__).parent.parent.glob("*.py")
        if p.name != "errores.py"
    )
    emitidos = set(re.findall(r'"([a-z]+_[a-z_]+)"', fuentes))
    assert CODIGOS_DEFINITIVOS <= emitidos
    assert "llm_invalido" not in CODIGOS_DEFINITIVOS


def test_la_bandera_explicita_gana_sobre_el_codigo():
    assert PipelineError("r2_error", "x", definitivo=True).definitivo is True
    assert PipelineError("asr_vacio", "x", definitivo=False).definitivo is False


def test_el_mensaje_lleva_codigo_y_texto_publico():
    e = PipelineError("asr_timeout", "AssemblyAI no completo")
    assert str(e) == "asr_timeout: AssemblyAI no completo"

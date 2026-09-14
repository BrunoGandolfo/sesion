"""Clasificacion transitorio / definitivo de los fallos del pipeline."""
from errores import CODIGOS_DEFINITIVOS, LeasePerdido, PipelineError


def test_los_codigos_de_la_lista_son_definitivos_y_el_resto_transitorio():
    for codigo in CODIGOS_DEFINITIVOS:
        assert PipelineError(codigo, "x").definitivo is True
    for codigo in ("r2_error", "asr_error", "asr_timeout", "llm_timeout", "app_error", "error_interno"):
        assert PipelineError(codigo, "x").definitivo is False


def test_la_bandera_explicita_gana_sobre_el_codigo():
    assert PipelineError("r2_error", "x", definitivo=True).definitivo is True
    assert PipelineError("asr_vacio", "x", definitivo=False).definitivo is False


def test_el_mensaje_lleva_codigo_y_texto_publico():
    e = PipelineError("asr_timeout", "AssemblyAI no completo")
    assert str(e) == "asr_timeout: AssemblyAI no completo"
    assert isinstance(LeasePerdido(), Exception)

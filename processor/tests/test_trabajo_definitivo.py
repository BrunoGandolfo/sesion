"""
Un trabajo que falla dice si es definitivo: {ok: false, error, definitivo}.

Definitivo = repetirlo da lo mismo (y, si hubo modelo, lo paga de nuevo).
Lo decide el mismo criterio que en las sesiones: el código del PipelineError
(errores.CODIGOS_DEFINITIVOS). La app usa la marca para dejar de reintentar.
"""
import pytest

import trabajos
from errores import PipelineError

TRANSCRIPCION = "[00:00] Terapeuta: hola"


def _feedback(mocker, error: PipelineError | Exception):
    mocker.patch("clinical_analyzer._cargar_prompt", return_value="prompt")
    mocker.patch("clinical_analyzer._llamar_validando", side_effect=error)
    return trabajos.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": {
        "transcripcionFormateada": TRANSCRIPCION, "orientacionTeorica": "cbt_mi"}})


@pytest.mark.parametrize("codigo", ["llm_rechazo", "llm_truncado", "llm_estructura_invalida"])
def test_un_feedback_que_el_modelo_no_puede_dar_es_definitivo(mocker, codigo):
    res = _feedback(mocker, PipelineError(codigo, "x"))
    assert (res["ok"], res["error"], res["definitivo"]) == (False, f"feedback_no_generado: {codigo}", True)


@pytest.mark.parametrize("error", [PipelineError("llm_timeout", "x"), PipelineError("llm_error", "x"), RuntimeError("boom")])
def test_un_feedback_que_puede_salir_mas_tarde_no_es_definitivo(mocker, error):
    res = _feedback(mocker, error)
    assert (res["ok"], res["definitivo"]) == (False, False)


@pytest.mark.parametrize("adjunto", [{}, {"transcripcionFormateada": TRANSCRIPCION, "orientacionTeorica": "freudiana"}])
def test_un_adjunto_de_feedback_inservible_es_definitivo(mocker, adjunto):
    mocker.patch("clinical_analyzer._llamar_validando")
    res = trabajos.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": adjunto})
    assert (res["ok"], res["definitivo"]) == (False, True)


def _integrar(**cambios):
    adjunto = {
        "tipo": "integrar_contexto", "sesionId": "s1", "pacienteId": "p1", "version": 0,
        "contextoVigente": None, "notaFinal": dict.fromkeys(["subjetivo", "objetivo", "analisis", "plan"], "nota"),
        "datos": {}, "fechaSesion": "2026-09-01", **cambios,
    }
    return {"tipo": "integrar_contexto", "adjunto": adjunto,
            "payload": {"sesionId": "s1", "pacienteId": "p1", "basadaEnVersion": 0}}


def test_un_adjunto_de_recorrido_invalido_es_definitivo(mocker):
    llamar = mocker.patch("trabajos.clinical_analyzer.actualizar_contexto_clinico")
    res = trabajos.ejecutar_trabajo(_integrar(fechaSesion="2026-02-30"))
    assert (res["ok"], res["definitivo"]) == (False, True)
    llamar.assert_not_called()


@pytest.mark.parametrize("codigo,definitivo", [("llm_estructura_invalida", True), ("llm_timeout", False)])
def test_el_recorrido_hereda_la_clasificacion_del_fallo_del_modelo(mocker, codigo, definitivo):
    mocker.patch("trabajos.clinical_analyzer.actualizar_contexto_clinico", side_effect=PipelineError(codigo, "x"))
    res = trabajos.ejecutar_trabajo(_integrar())
    assert (res["ok"], res["definitivo"]) == (False, definitivo)


def test_el_borrado_que_espera_al_worker_dueno_no_es_definitivo(mocker):
    mocker.patch("trabajos.asr_assemblyai._borrar")
    res = trabajos.ejecutar_trabajo({"tipo": "borrar_transcript_asr", "payload": {"transcriptId": "tr1"}, "intentos": 1})
    assert (res["error"], res["definitivo"]) == ("esperando_al_worker_del_transcript", False)


@pytest.mark.parametrize("status", [None, 500])
def test_un_borrado_que_assemblyai_no_contesta_no_es_definitivo(mocker, status):
    mocker.patch("trabajos.asr_assemblyai._borrar", return_value=status)
    intento = trabajos.primer_intento_que_borra()
    res = trabajos.ejecutar_trabajo({"tipo": "borrar_transcript_asr", "payload": {"transcriptId": "tr1"}, "intentos": intento})
    assert (res["ok"], res["definitivo"]) == (False, False)


def test_un_borrado_sin_transcript_id_es_definitivo():
    res = trabajos.ejecutar_trabajo({"tipo": "borrar_transcript_asr", "payload": {}, "intentos": 9})
    assert (res["ok"], res["definitivo"]) == (False, True)


def test_un_tipo_que_este_worker_no_conoce_no_es_definitivo():
    # Durante un deploy, un worker viejo puede recibir un tipo nuevo: el
    # siguiente intento lo toma uno que sí lo conoce.
    res = trabajos.ejecutar_trabajo({"tipo": "inventado"})
    assert (res["ok"], res["definitivo"]) == (False, False)


def test_el_exito_no_lleva_la_marca(mocker):
    mocker.patch("trabajos.asr_assemblyai._borrar", return_value=200)
    res = trabajos.ejecutar_trabajo({"tipo": "borrar_transcript_asr", "payload": {"transcriptId": "tr1"},
                                      "intentos": trabajos.primer_intento_que_borra()})
    assert res["ok"] is True and "definitivo" not in res

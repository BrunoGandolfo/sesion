"""
Orquestacion de procesar_sesion con todos los pasos mockeados. Se verifica
que cada fallo llegue al callback con el estado, el codigo y el modelo ASR
correctos. Sin red.
"""
import logging

import pytest

import config
import processor
from app_client import RespuestaCallback
from errores import PipelineError

TRANSCRIPCION = {
    "duration_seconds": 3,
    "segments": [{"speaker": "S0", "start": 0.0, "end": 1.0, "text": "hola"}],
    "roles_origen": "asr_role",
    "asr_id": "tr1",
    "speech_model": "universal-2",
}

ANALISIS = processor.Analisis(
    transcripcion_fmt="[00:00] Terapeuta: hola",
    nota={"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
    datos_estructurados={"temas": ["x"]},
    prompt_nota="clinical_note_v3.1.1.md",
    prompt_feedback="therapist_feedback_v1.1.md",
)

ASR_PROVISIONAL = f"assemblyai:{config.ASR_MODEL_ID}"
LLM = f"{config.LLM_BACKEND}:{config.LLM_MODEL_ID}"


@pytest.fixture
def pasos(mocker):
    """Pasos exitosos por defecto; cada test rompe el que le interesa."""
    mocker.patch("processor.descargar_y_descifrar", return_value=b"audio")
    mocker.patch("processor.transcribir", return_value=TRANSCRIPCION)
    mocker.patch("processor.analizar", return_value=ANALISIS)
    callback = mocker.patch(
        "processor.app_client.enviar_callback",
        return_value=RespuestaCallback(ok=True, status=200),
    )
    return mocker, callback


def _correr():
    processor.procesar_sesion(
        sesion_clinica_id="s1",
        audio_r2_key="audio/org/s1/t1.enc",
        clave_cifrado="clave",
        iv_cifrado="iv",
        paciente_id="p1",
        orientacion_teorica="cbt_mi",
        intento=2,
    )


def test_exito_reporta_revision_con_el_modelo_asr_real(pasos):
    _, callback = pasos

    _correr()

    callback.assert_called_once()
    kw = callback.call_args.kwargs
    assert kw["sesion_clinica_id"] == "s1"
    assert kw["estado"] == "revision"
    assert kw["modelo_asr"] == "assemblyai:universal-2"
    assert kw["modelo_llm"] == LLM
    assert kw["nota"] == ANALISIS.nota
    assert kw["transcripcion"] == ANALISIS.transcripcion_fmt
    assert kw["prompt_version"] == "clinical_note_v3.1.1.md+therapist_feedback_v1.1.md"
    pipeline = kw["datos_estructurados"]["_pipeline"]
    assert pipeline["intento"] == 2
    assert pipeline["asrId"] == "tr1"
    assert pipeline["modeloASR"] == "assemblyai:universal-2"
    assert "duracionAudioSeg" not in kw["datos_estructurados"]
    # Los dos campos nuevos viajan siempre, aunque no haya nada que reportar.
    assert pipeline["advertencias"] == []
    assert pipeline["reintentosLLM"] == 0


def test_las_advertencias_y_el_reintento_viajan_en_pipeline(pasos):
    mocker, callback = pasos
    mocker.patch(
        "processor.analizar",
        return_value=processor.Analisis(
            transcripcion_fmt=ANALISIS.transcripcion_fmt,
            nota=ANALISIS.nota,
            datos_estructurados={"temas": ["x"]},
            prompt_nota=ANALISIS.prompt_nota,
            prompt_feedback=ANALISIS.prompt_feedback,
            advertencias=["intensidadEmocional=0 fuera de rango 1..10, anulado"],
            reintentos_llm=1,
        ),
    )

    _correr()

    kw = callback.call_args.kwargs
    # Lo importante: la sesion llega a revision igual.
    assert kw["estado"] == "revision"
    pipeline = kw["datos_estructurados"]["_pipeline"]
    assert pipeline["advertencias"] == [
        "intensidadEmocional=0 fuera de rango 1..10, anulado"
    ]
    assert pipeline["reintentosLLM"] == 1


def test_fallo_en_asr_reporta_error_con_el_modelo_provisional(pasos):
    mocker, callback = pasos
    mocker.patch(
        "processor.transcribir",
        side_effect=PipelineError("asr_error", "AssemblyAI respondio 500 en upload"),
    )

    _correr()

    callback.assert_called_once()
    kw = callback.call_args.kwargs
    assert kw["estado"] == "error"
    assert kw["error"] == "asr_error: AssemblyAI respondio 500 en upload"
    assert kw["modelo_asr"] == ASR_PROVISIONAL
    assert kw["modelo_llm"] == LLM


def test_fallo_en_llm_reporta_error_con_el_modelo_asr_real(pasos):
    mocker, callback = pasos
    mocker.patch(
        "processor.analizar",
        side_effect=PipelineError("llm_timeout", "Anthropic no respondio a tiempo"),
    )

    _correr()

    kw = callback.call_args.kwargs
    assert kw["estado"] == "error"
    assert kw["error"] == "llm_timeout: Anthropic no respondio a tiempo"
    assert kw["modelo_asr"] == "assemblyai:universal-2"


def test_fallo_en_descarga_reporta_r2_error(pasos):
    mocker, callback = pasos
    mocker.patch(
        "processor.descargar_y_descifrar",
        side_effect=PipelineError("r2_error", "No se pudo descargar el audio de R2"),
    )

    _correr()

    kw = callback.call_args.kwargs
    assert kw["estado"] == "error"
    assert kw["error"] == "r2_error: No se pudo descargar el audio de R2"


def test_excepcion_inesperada_reporta_error_interno_sin_detalle(pasos, caplog):
    mocker, callback = pasos
    mocker.patch("processor.analizar", side_effect=KeyError("segments"))

    with caplog.at_level("ERROR"):
        _correr()

    kw = callback.call_args.kwargs
    assert kw["estado"] == "error"
    assert kw["error"] == "error_interno"
    # Sin traza: el registro no lleva exc_info.
    assert all(r.exc_info is None for r in caplog.records)


def test_callback_no_terminal_no_lanza(pasos):
    mocker, callback = pasos
    callback.return_value = RespuestaCallback(ok=False, status=503)

    _correr()  # el lease de la app reintentara; no hay callback de error

    assert callback.call_count == 1
    assert callback.call_args.kwargs["estado"] == "revision"


def test_pasos_reales_sin_clave_ni_dev(mocker):
    with pytest.raises(PipelineError) as exc:
        processor.descargar_y_descifrar("s1", "k", "", "iv", 1)
    assert exc.value.codigo == "audio_sin_clave"

    with pytest.raises(PipelineError) as exc:
        processor.descargar_y_descifrar("s1", "dev-no-r2", "c", "iv", 1)
    assert exc.value.codigo == "audio_dev"


def test_transcribir_sin_segmentos_es_asr_vacio(mocker):
    mocker.patch("processor.asr_assemblyai.transcribir", return_value={"segments": []})
    with pytest.raises(PipelineError) as exc:
        processor.transcribir("s1", b"audio")
    assert exc.value.codigo == "asr_vacio"


def test_el_feedback_no_generado_viaja_en_el_payload_y_la_sesion_sigue(pasos):
    """
    El caso del fin de semana del 6-7/9/2026 despues del arreglo: el feedback
    se trunco las dos veces y no salio. La sesion tiene que llegar igual a
    revision, sin feedback inventado, y con la advertencia de clave estable
    dentro de _pipeline.advertencias, que es lo que la app guarda.
    """
    mocker, callback = pasos
    mocker.patch(
        "processor.analizar",
        return_value=processor.Analisis(
            transcripcion_fmt=ANALISIS.transcripcion_fmt,
            nota=ANALISIS.nota,
            datos_estructurados={"temas": ["x"]},
            prompt_nota=ANALISIS.prompt_nota,
            prompt_feedback="therapist_feedback_gestalt_v1.1.md",
            advertencias=["feedback_no_generado: llm_truncado"],
        ),
    )

    _correr()

    kw = callback.call_args.kwargs
    assert kw["estado"] == "revision"
    assert kw["nota"] == ANALISIS.nota
    datos = kw["datos_estructurados"]
    assert "feedbackTerapeuta" not in datos
    assert datos["_pipeline"]["advertencias"] == ["feedback_no_generado: llm_truncado"]


def test_analizar_no_pone_feedback_cuando_el_llm_lo_trunco_dos_veces(mocker):
    """
    Cableado real del paso `analizar` con la Llamada C fallando: la clave
    feedbackTerapeuta no se crea (null antes que inventar) y la advertencia
    del analizador se propaga tal cual.
    """
    from clinical_analyzer import DiagnosticoLLM

    mocker.patch("processor.formatear_para_llm", return_value="[00:00] T: hola")
    mocker.patch("processor.speech_analytics.compute", return_value={"ratio": 1})
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    mocker.patch(
        "processor.clinical_analyzer.analizar",
        return_value=(
            {"nota": ANALISIS.nota, "datosEstructurados": {"temas": ["x"]}},
            "clinical_note_v3.1.1.md",
            DiagnosticoLLM(reintentos=0, advertencias=[]),
        ),
    )
    mocker.patch(
        "processor.clinical_analyzer.generar_feedback_terapeuta",
        return_value=(
            None,
            "therapist_feedback_gestalt_v1.1.md",
            DiagnosticoLLM(advertencias=["feedback_no_generado: llm_truncado"]),
        ),
    )

    analisis = processor.analizar("s1", TRANSCRIPCION, "p1", "gestalt")

    assert "feedbackTerapeuta" not in analisis.datos_estructurados
    assert analisis.advertencias == ["feedback_no_generado: llm_truncado"]
    assert analisis.nota == ANALISIS.nota


def test_analizar_junta_las_advertencias_de_nota_y_feedback(mocker):
    """
    Cableado real del paso `analizar`: verifica que consume las tres piezas
    que devuelven clinical_analyzer.analizar y generar_feedback_terapeuta.
    """
    from clinical_analyzer import DiagnosticoLLM

    mocker.patch("processor.formatear_para_llm", return_value="[00:00] T: hola")
    mocker.patch("processor.speech_analytics.compute", return_value={"ratio": 1})
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    mocker.patch(
        "processor.clinical_analyzer.analizar",
        return_value=(
            {"nota": ANALISIS.nota, "datosEstructurados": {"temas": ["x"]}},
            "clinical_note_v3.1.1.md",
            DiagnosticoLLM(reintentos=1, advertencias=["duracionRealMin=-1 invalido, anulado"]),
        ),
    )
    mocker.patch(
        "processor.clinical_analyzer.generar_feedback_terapeuta",
        return_value=(
            {"mitiCounts": {}},
            "therapist_feedback_v1.1.md",
            DiagnosticoLLM(reintentos=1, advertencias=["feedback advertido"]),
        ),
    )

    analisis = processor.analizar("s1", TRANSCRIPCION, "p1", "cbt_mi")

    assert analisis.reintentos_llm == 1
    assert analisis.advertencias == [
        "duracionRealMin=-1 invalido, anulado",
        "feedback advertido",
        "feedbackTerapeuta requirio una segunda pasada",
    ]
    assert analisis.datos_estructurados["feedbackTerapeuta"] == {"mitiCounts": {}}
    assert analisis.datos_estructurados["speechAnalytics"] == {
        "ratio": 1,
        "rolesOrigen": "asr_role",
    }


# HotWords: terminosAsr de la sesion reclamada ──────────────────────────────


def test_sesion_sin_el_campo_da_lista_vacia():
    # El caso de hoy: la app todavia no manda terminosAsr y el worker tiene
    # que procesar igual.
    assert processor.terminos_asr_de({"sesionClinicaId": "s1"}) == []


def test_sesion_con_el_campo_en_null_da_lista_vacia():
    assert processor.terminos_asr_de({"terminosAsr": None}) == []


def test_sesion_con_terminos_los_devuelve_en_orden():
    sesion = {"terminosAsr": ["GTFS", "alianza terapéutica", "MITI 4.2.1"]}
    assert processor.terminos_asr_de(sesion) == [
        "GTFS",
        "alianza terapéutica",
        "MITI 4.2.1",
    ]


def test_terminos_asr_descarta_lo_que_no_sea_texto_con_contenido():
    sesion = {"terminosAsr": ["GTFS", "", "   ", None, 7, ["x"], "CTS-R"]}
    assert processor.terminos_asr_de(sesion) == ["GTFS", "CTS-R"]


def test_terminos_asr_ignora_un_campo_que_no_sea_lista():
    # Si la app manda cualquier otra cosa, el worker no se cae por eso.
    for valor in ("GTFS", {"a": 1}, 3, True):
        assert processor.terminos_asr_de({"terminosAsr": valor}) == []


def test_procesar_sesion_pasa_los_terminos_al_asr(pasos):
    mocker, _ = pasos
    transcribir = mocker.patch("processor.transcribir", return_value=TRANSCRIPCION)

    processor.procesar_sesion(
        sesion_clinica_id="s1",
        audio_r2_key="audio/org/s1/t1.enc",
        clave_cifrado="clave",
        iv_cifrado="iv",
        terminos_asr=["GTFS", "MITI 4.2.1"],
    )

    assert transcribir.call_args.args[2] == ["GTFS", "MITI 4.2.1"]


def test_procesar_sesion_sin_terminos_sigue_funcionando(pasos):
    mocker, callback = pasos
    transcribir = mocker.patch("processor.transcribir", return_value=TRANSCRIPCION)

    _correr()

    assert transcribir.call_args.args[2] is None
    assert callback.call_args.kwargs["estado"] == "revision"


def test_paso_transcribir_le_pasa_los_terminos_a_assemblyai(mocker):
    asr = mocker.patch("processor.asr_assemblyai.transcribir", return_value=TRANSCRIPCION)

    processor.transcribir("s1", b"audio", ["GTFS"])

    assert asr.call_args.args[1] == ["GTFS"]


def test_paso_transcribir_sin_terminos_manda_lista_vacia(mocker):
    asr = mocker.patch("processor.asr_assemblyai.transcribir", return_value=TRANSCRIPCION)

    processor.transcribir("s1", b"audio")

    assert asr.call_args.args[1] == []


def test_el_log_del_paso_no_nombra_los_terminos(mocker, caplog):
    mocker.patch("processor.asr_assemblyai.transcribir", return_value=TRANSCRIPCION)

    with caplog.at_level(logging.DEBUG):
        processor.transcribir("s1", b"audio", ["NOMBRE-SECRETO", "GTFS"])

    mensajes = [r.getMessage() for r in caplog.records]
    assert any("2 terminos ASR" in m for m in mensajes)
    assert all("NOMBRE-SECRETO" not in m for m in mensajes)

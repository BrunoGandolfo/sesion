"""
Orquestacion de procesar_sesion con todos los pasos mockeados. Se verifica
que cada fallo llegue al callback con el estado, el codigo y el modelo ASR
correctos. Sin red.
"""
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
    prompt_nota="clinical_note_v3.1.md",
    prompt_feedback="therapist_feedback_v1.0.md",
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
    assert kw["prompt_version"] == "clinical_note_v3.1.md+therapist_feedback_v1.0.md"
    pipeline = kw["datos_estructurados"]["_pipeline"]
    assert pipeline["intento"] == 2
    assert pipeline["asrId"] == "tr1"
    assert pipeline["modeloASR"] == "assemblyai:universal-2"
    assert "duracionAudioSeg" not in kw["datos_estructurados"]


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

"""
`uso`: lo que el worker le manda a la app en cada resultado y en cada trabajo
para diagnosticar sin entrar a Railway (forense 04-worker.md §7.2).

La forma es la de usoSchema (src/lib/sesion-clinica/schema.ts): asrSegundos y
llamadas[] con nombre, entrada y salida enteros; el resto entra por
.passthrough(). La app lo guarda sin cifrar: solo numeros, codigos e ids.

Sin red: el cliente de Anthropic es un doble con la forma de la respuesta del
SDK; el ASR, R2 y la app tambien.
"""
import importlib
import json
from types import SimpleNamespace

import anthropic
import pytest

import clinical_analyzer
import config
import processor
from app_client import RespuestaApp
from processor import SesionReclamada

TICKET = "a" * 64
TEXTO_CLINICO = "Hola, ¿cómo llegaste hoy? Bastante cansada, dormí poco."

NOTA_OK = {
    "nota": {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
    "datosEstructurados": {
        # Fuera de rango: se anula y queda como advertencia de saneo.
        "intensidadEmocional": 0,
        "alianzaTerapeutica": "estable",
        "duracionRealMin": 50,
        "riesgoDetectado": {"nivel": "ninguno", "indicadores": [], "evidencia": [], "notaParaTerapeuta": None},
    },
}


def respuesta_sdk(cuerpo: dict | str, stop="end_turn", entrada=21000, salida=9000, razonamiento=6500, request_id="req_01"):
    """Lo que devuelve messages.create del SDK 1.x, con los campos que se leen."""
    texto = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)
    return SimpleNamespace(
        usage=SimpleNamespace(
            input_tokens=entrada,
            output_tokens=salida,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
            output_tokens_details=SimpleNamespace(thinking_tokens=razonamiento),
        ),
        stop_reason=stop,
        content=[SimpleNamespace(type="text", text=texto)],
        _request_id=request_id,
    )


@pytest.fixture
def anthropic_doble(mocker):
    cliente = mocker.Mock()
    mocker.patch("clinical_analyzer._cliente", return_value=cliente)
    mocker.patch("clinical_analyzer._cargar_prompt", return_value="SYSTEM")
    return cliente.messages.create


@pytest.fixture
def pipeline(mocker):
    """procesar_sesion con R2, ASR y app de dobles; analizar y el modelo son los reales."""
    mocker.patch("processor.LEASE_RENOVACION_SEG", 3600)
    ok = RespuestaApp(ok=True, status=200)
    mocker.patch("processor.app_client.registrar_asr", return_value=ok)
    mocker.patch("processor.app_client.registrar_transcripcion", return_value=ok)
    mocker.patch("processor.app_client.renovar_lease", return_value=ok)
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    mocker.patch("processor.descargar_audio", return_value=b"audio")
    mocker.patch("processor.preparar_para_asr", side_effect=lambda _e, audio: audio)
    mocker.patch(
        "processor.transcribir",
        return_value={
            "duration_seconds": 3232,
            "segments": [{"speaker": "S0", "start": 0.0, "end": 4.0, "text": TEXTO_CLINICO}],
            "roles_origen": "asr_role",
            "asr_id": "tr1",
            "speech_model": "universal-3-5-pro",
        },
    )
    resultado = mocker.patch("processor.app_client.enviar_resultado", return_value=ok)
    mocker.patch("uso.config.WORKER_VERSION", "1a2b3c4")

    def correr():
        processor.procesar_sesion(
            SesionReclamada(
                sesion_clinica_id="s1", intento=1, ticket=TICKET, paciente_id="p1",
                terminos_asr=[], audio={"key": "org/s1/0"}, checkpoint=None, duracion_audio_seg=3232,
            )
        )
        return resultado.call_args.args[2]

    return correr


# Sesion ─────────────────────────────────────────────────────────────────────

def test_la_nota_viaja_con_el_uso_de_la_corrida(pipeline, anthropic_doble, mocker):
    # Primera pasada truncada, segunda completa: las dos se pagaron y las dos
    # tienen que aparecer.
    anthropic_doble.side_effect = [
        respuesta_sdk("{", stop="max_tokens", salida=16384, razonamiento=15900, request_id="req_01"),
        respuesta_sdk(NOTA_OK, request_id="req_02"),
    ]
    # Duraciones fijas: los pasos 2 s, cada llamada 3 s.
    mocker.patch("uso.ms_desde", return_value=2000)
    mocker.patch("clinical_analyzer.ms_desde", return_value=3000)

    payload = pipeline()

    assert payload["resultado"] == "nota"
    uso = payload["uso"]
    assert uso == {
        "worker": "1a2b3c4",
        "asrSegundos": 3232,
        "pasosMs": {"descarga": 2000, "normalizacion": 2000, "asr": 2000},
        "llamadas": [
            {
                "nombre": "nota#1", "entrada": 21000, "salida": 16384, "techo": config.LLM_MAX_TOKENS_NOTA,
                "ms": 3000, "cacheLectura": 0, "cacheEscritura": 0, "razonamiento": 15900,
                "stop": "max_tokens", "requestId": "req_01", "error": "llm_truncado",
            },
            {
                "nombre": "nota#2", "entrada": 21000, "salida": 9000, "techo": config.LLM_MAX_TOKENS_REINTENTO,
                "ms": 3000, "cacheLectura": 0, "cacheEscritura": 0, "razonamiento": 6500,
                "stop": "end_turn", "requestId": "req_02",
            },
        ],
        "reintentos": 1,
        "advertencias": ["intensidadEmocional=0 fuera de rango 1..10, anulado"],
    }


def test_el_uso_no_lleva_texto_de_la_sesion(pipeline, anthropic_doble):
    anthropic_doble.side_effect = [respuesta_sdk(NOTA_OK)]

    uso = json.dumps(pipeline()["uso"], ensure_ascii=False)

    for fragmento in ("cansada", "dormí", "Hola", "subjetivo", "SYSTEM"):
        assert fragmento not in uso


def test_un_fallo_lleva_lo_que_ya_se_pago(pipeline, anthropic_doble):
    # El ASR se cobro y las dos pasadas tambien: la sesion falla igual, pero
    # el uso tiene que decir cuanto costo llegar hasta ahi.
    anthropic_doble.side_effect = [
        respuesta_sdk("{", stop="max_tokens"),
        respuesta_sdk("{", stop="max_tokens"),
    ]

    payload = pipeline()

    assert payload["resultado"] == "fallo" and payload["codigo"] == "llm_truncado"
    assert payload["uso"]["asrSegundos"] == 3232
    assert [l["nombre"] for l in payload["uso"]["llamadas"]] == ["nota#1", "nota#2"]
    assert all(l["error"] == "llm_truncado" for l in payload["uso"]["llamadas"])
    assert set(payload["uso"]["pasosMs"]) == {"descarga", "normalizacion", "asr"}


def test_un_timeout_queda_anotado_con_su_duracion(pipeline, anthropic_doble):
    anthropic_doble.side_effect = anthropic.APITimeoutError(request=SimpleNamespace())

    payload = pipeline()

    assert payload["codigo"] == "llm_timeout"
    [llamada] = payload["uso"]["llamadas"]
    assert llamada["nombre"] == "nota#1" and llamada["error"] == "llm_timeout"
    assert (llamada["entrada"], llamada["salida"]) == (0, 0)
    assert isinstance(llamada["ms"], int)


def test_con_checkpoint_no_hay_asr_que_contar(mocker, anthropic_doble):
    mocker.patch("processor.LEASE_RENOVACION_SEG", 3600)
    ok = RespuestaApp(ok=True, status=200)
    mocker.patch("processor.app_client.renovar_lease", return_value=ok)
    mocker.patch("processor.app_client.obtener_contexto_clinico_llm", return_value=None)
    resultado = mocker.patch("processor.app_client.enviar_resultado", return_value=ok)
    anthropic_doble.side_effect = [respuesta_sdk(NOTA_OK)]

    processor.procesar_sesion(
        SesionReclamada(
            sesion_clinica_id="s1", intento=2, ticket=TICKET, paciente_id="p1", terminos_asr=[],
            audio=None, checkpoint={"transcripcion": "[00:00] Terapeuta: hola", "modeloAsr": "assemblyai:x"},
        )
    )

    uso = resultado.call_args.args[2]["uso"]
    assert "asrSegundos" not in uso and "pasosMs" not in uso
    assert [l["nombre"] for l in uso["llamadas"]] == ["nota#1"]


# Trabajos ───────────────────────────────────────────────────────────────────

FEEDBACK_ADJUNTO = {"transcripcionFormateada": "[00:00] Terapeuta: hola", "orientacionTeorica": "cbt_mi"}


def test_cada_trabajo_lleva_uso(mocker, anthropic_doble):
    anthropic_doble.side_effect = [respuesta_sdk("no es json"), respuesta_sdk("tampoco")]

    res = processor.ejecutar_trabajo({"tipo": "generar_feedback", "adjunto": FEEDBACK_ADJUNTO})

    assert res["ok"] is False
    assert [l["nombre"] for l in res["uso"]["llamadas"]] == ["feedback#1", "feedback#2"]
    assert res["uso"]["reintentos"] == 1
    assert set(res["uso"]["pasosMs"]) == {"generar_feedback"}

    delete = mocker.patch("processor.requests.delete", return_value=mocker.Mock(status_code=200))
    res = processor.ejecutar_trabajo({"tipo": "borrar_transcript_asr", "payload": {"transcriptId": "tr1"}})
    assert res["ok"] is True and res["uso"]["llamadas"] == [] and "borrar_transcript_asr" in res["uso"]["pasosMs"]
    delete.assert_called_once()

    res = processor.ejecutar_trabajo({"tipo": "desconocido"})
    assert res["ok"] is False and "uso" in res


def test_el_contexto_anota_sus_llamadas(anthropic_doble):
    contenido = {
        "hipotesisDiagnostica": None, "resumenAcumulativo": "r", "objetivosTerapeuticos": [],
        "intervencionesProbadas": [], "temasRecurrentes": [], "riesgosHistoricos": [], "cambios": [],
    }
    anthropic_doble.side_effect = [respuesta_sdk(contenido)]
    trabajo = {
        "tipo": "integrar_contexto",
        "payload": {"sesionId": "s1", "pacienteId": "p1", "basadaEnVersion": 1},
        "adjunto": {
            "tipo": "integrar_contexto", "sesionId": "s1", "pacienteId": "p1", "version": 1,
            "contextoVigente": contenido, "notaFinal": dict.fromkeys(["subjetivo", "objetivo", "analisis", "plan"], "n"),
            "datos": {}, "fechaSesion": "2026-09-01",
        },
    }

    res = processor.ejecutar_trabajo(trabajo)

    assert res["ok"] is True
    [llamada] = res["uso"]["llamadas"]
    assert llamada["nombre"] == "contexto#1" and llamada["techo"] == config.LLM_MAX_TOKENS


def test_una_estructura_invalida_se_marca_en_su_pasada(anthropic_doble):
    sin_plan = json.loads(json.dumps(NOTA_OK))
    del sin_plan["nota"]["plan"]
    anthropic_doble.side_effect = [respuesta_sdk(sin_plan), respuesta_sdk(NOTA_OK)]
    llamadas: list[dict] = []

    clinical_analyzer.analizar("[00:00] Terapeuta: hola", llamadas=llamadas)

    assert llamadas[0]["error"] == "llm_estructura_invalida"
    assert "error" not in llamadas[1]


# Version del worker y APP_BASE_URL ──────────────────────────────────────────

@pytest.fixture
def recargar_config(monkeypatch):
    """Relee config.py con otras variables; al final lo deja como estaba."""
    def recargar(**env):
        for clave in ("WORKER_VERSION", "RAILWAY_GIT_COMMIT_SHA", "RAILWAY_ENVIRONMENT_ID"):
            monkeypatch.delenv(clave, raising=False)
        for clave, valor in env.items():
            monkeypatch.setenv(clave, valor)
        return importlib.reload(config)

    yield recargar
    monkeypatch.undo()
    importlib.reload(config)


def test_worker_version_sale_del_commit_de_railway(recargar_config):
    sha = "d0beb8f5c55b36df7d674d55965a23b8d54ad69b"
    assert recargar_config(RAILWAY_GIT_COMMIT_SHA=sha).WORKER_VERSION == "d0beb8f"
    assert recargar_config(RAILWAY_GIT_COMMIT_SHA=sha, WORKER_VERSION="hotfix").WORKER_VERSION == "hotfix"
    assert recargar_config().WORKER_VERSION == "local"


@pytest.mark.parametrize(
    ("url", "en_railway", "valida"),
    [
        ("https://sesion.example.com", True, True),
        ("https://sesion.example.com", False, True),
        ("http://localhost:3001", False, True),
        ("http://127.0.0.1:3001", False, True),
        # El default en Railway: APP_BASE_URL no se cargo.
        ("http://localhost:3001", True, False),
        ("http://sesion.example.com", False, False),
        ("http://sesion.example.com", True, False),
        ("sesion.example.com", True, False),
        ("https://", True, False),
        ("", False, False),
    ],
)
def test_app_base_url(url, en_railway, valida):
    assert config._app_base_url_valida(url, en_railway) is valida


def test_validar_config_rechaza_app_base_url_sin_https_en_railway(recargar_config):
    cfg = recargar_config(
        RAILWAY_ENVIRONMENT_ID="env", APP_BASE_URL="http://localhost:3001",
        R2_ENDPOINT="https://r2", R2_ACCESS_KEY_ID="k", R2_SECRET_ACCESS_KEY="s",
    )
    with pytest.raises(RuntimeError, match="APP_BASE_URL"):
        cfg.validar_config()
    recargar_config(
        RAILWAY_ENVIRONMENT_ID="env", APP_BASE_URL="https://sesion.example.com",
        R2_ENDPOINT="https://r2", R2_ACCESS_KEY_ID="k", R2_SECRET_ACCESS_KEY="s",
    ).validar_config()

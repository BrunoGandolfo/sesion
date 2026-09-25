"""
La frontera con Anthropic (clinical_analyzer._cliente y _llamar_anthropic):
como se construye el cliente y que pedido sale. Sin red: el constructor y
messages.create son dobles.
"""
import json
from types import SimpleNamespace

import anthropic
import pytest

import clinical_analyzer
import config
from errores import PipelineError
from schemas_llm import SCHEMA_NOTA


@pytest.fixture
def cliente_nuevo(mocker):
    """Fuerza a _cliente() a construir de nuevo, con el constructor del SDK doblado."""
    mocker.patch("clinical_analyzer._cliente_anthropic", None)
    return mocker.patch("clinical_analyzer.anthropic.Anthropic")


def test_el_cliente_va_con_timeout_de_600_y_un_solo_reintento(cliente_nuevo, mocker):
    mocker.patch("clinical_analyzer.config.ANTHROPIC_WORKSPACE_ID", "")

    clinical_analyzer._cliente()

    kwargs = cliente_nuevo.call_args.kwargs
    assert kwargs["timeout"] == config.LLM_TIMEOUT_SECONDS == 600
    assert kwargs["max_retries"] == 1
    assert "default_headers" not in kwargs


def test_con_workspace_el_cliente_manda_la_cabecera(cliente_nuevo, mocker):
    mocker.patch("clinical_analyzer.config.ANTHROPIC_WORKSPACE_ID", "wrkspc_1")

    clinical_analyzer._cliente()

    assert cliente_nuevo.call_args.kwargs["default_headers"] == {"anthropic-workspace-id": "wrkspc_1"}


def test_el_pedido_no_lleva_cache_control(mocker):
    cliente = mocker.Mock()
    cliente.messages.create.return_value = SimpleNamespace(
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
        stop_reason="end_turn",
        content=[SimpleNamespace(type="text", text=json.dumps({"ok": True}))],
    )
    mocker.patch("clinical_analyzer._cliente", return_value=cliente)

    clinical_analyzer._llamar_anthropic("SYSTEM", "user", SCHEMA_NOTA, 16384)

    kwargs = cliente.messages.create.call_args.kwargs
    assert kwargs["system"] == "SYSTEM"
    assert "cache_control" not in json.dumps(kwargs, default=str)
    assert kwargs["max_tokens"] == 16384


# Transporte: timeout, HTTP y conexion ──────────────────────────────────────
#
# Los tres son PipelineError transitorios con codigo estable (contrato con la
# app): la sesion vuelve a la cola. No se reintentan en _llamar_validando.

def _cliente_que_lanza(mocker, error):
    cliente = mocker.Mock()
    cliente.messages.create.side_effect = error
    mocker.patch("clinical_analyzer._cliente", return_value=cliente)
    return cliente


def _estado_http(status: int):
    respuesta = SimpleNamespace(
        status_code=status, request=SimpleNamespace(), headers={"request-id": "req_http"}
    )
    cuerpo = {"error": {"type": "overloaded_error", "message": "Overloaded"}}
    return anthropic.APIStatusError("error", response=respuesta, body=cuerpo)


@pytest.mark.parametrize(
    ("error", "codigo"),
    [
        (lambda: anthropic.APITimeoutError(request=SimpleNamespace()), "llm_timeout"),
        (lambda: _estado_http(529), "llm_error"),
        (lambda: _estado_http(400), "llm_error"),
        (lambda: anthropic.APIConnectionError(request=SimpleNamespace()), "llm_error"),
    ],
)
def test_el_transporte_de_anthropic_se_traduce_a_un_codigo_transitorio(mocker, error, codigo):
    cliente = _cliente_que_lanza(mocker, error())
    llamadas: list[dict] = []

    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_validando("SYSTEM", "user", SCHEMA_NOTA, llamadas=llamadas, nombre="nota")

    assert exc.value.codigo == codigo
    assert exc.value.definitivo is False
    assert cliente.messages.create.call_count == 1
    assert [l["error"] for l in llamadas] == [codigo]


def test_el_error_http_anota_el_request_id_y_el_status_en_el_detalle(mocker):
    _cliente_que_lanza(mocker, _estado_http(529))
    llamadas: list[dict] = []

    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_anthropic("SYSTEM", "user", SCHEMA_NOTA, 100, llamadas, "nota#1")

    assert "529" in exc.value.mensaje_publico
    assert llamadas[0]["requestId"] == "req_http"


def test_un_rechazo_del_modelo_es_llm_rechazo(mocker):
    cliente = mocker.Mock()
    cliente.messages.create.return_value = SimpleNamespace(
        usage=SimpleNamespace(input_tokens=10, output_tokens=1), stop_reason="refusal", content=[]
    )
    mocker.patch("clinical_analyzer._cliente", return_value=cliente)

    with pytest.raises(PipelineError) as exc:
        clinical_analyzer._llamar_anthropic("SYSTEM", "user", SCHEMA_NOTA, 100)

    assert exc.value.codigo == "llm_rechazo"

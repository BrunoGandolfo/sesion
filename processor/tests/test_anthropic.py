"""
La frontera con Anthropic (clinical_analyzer._cliente y _llamar_anthropic):
como se construye el cliente y que pedido sale. Sin red: el constructor y
messages.create son dobles.
"""
import json
from types import SimpleNamespace

import pytest

import clinical_analyzer
import config
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

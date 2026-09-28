"""
config.py: la version que se reporta y validar_config, que corre al arrancar
el worker (worker.main) y lo tira abajo con la lista de lo que falta.
"""
import importlib

import pytest

import config

R2_COMPLETO = {"R2_ENDPOINT": "https://r2.example.com", "R2_ACCESS_KEY_ID": "k", "R2_SECRET_ACCESS_KEY": "s"}


@pytest.fixture
def recargar_config(monkeypatch):
    """Relee config.py con otras variables; al final lo deja como estaba."""
    def recargar(**env):
        for clave in ("WORKER_VERSION", "RAILWAY_GIT_COMMIT_SHA", "RAILWAY_ENVIRONMENT_ID", *R2_COMPLETO):
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
    cfg = recargar_config(RAILWAY_ENVIRONMENT_ID="env", APP_BASE_URL="http://localhost:3001", **R2_COMPLETO)
    with pytest.raises(RuntimeError, match="APP_BASE_URL"):
        cfg.validar_config()
    recargar_config(RAILWAY_ENVIRONMENT_ID="env", APP_BASE_URL="https://sesion.example.com", **R2_COMPLETO).validar_config()


def test_validar_config_completa_no_lanza(recargar_config):
    recargar_config(APP_BASE_URL="https://sesion.example.com", **R2_COMPLETO).validar_config()


@pytest.mark.parametrize("falta", ["PROCESSING_SECRET", "ANTHROPIC_API_KEY", "ASSEMBLYAI_API_KEY"])
def test_validar_config_nombra_el_secreto_que_falta(recargar_config, falta):
    cfg = recargar_config(APP_BASE_URL="https://sesion.example.com", **R2_COMPLETO, **{falta: ""})
    with pytest.raises(RuntimeError, match=falta):
        cfg.validar_config()


def test_validar_config_exige_r2_completo(recargar_config):
    incompleto = {**R2_COMPLETO, "R2_SECRET_ACCESS_KEY": ""}
    cfg = recargar_config(APP_BASE_URL="https://sesion.example.com", **incompleto)
    with pytest.raises(RuntimeError, match="R2 incompleto"):
        cfg.validar_config()


def test_validar_config_junta_todos_los_errores(recargar_config):
    cfg = recargar_config(RAILWAY_ENVIRONMENT_ID="env", APP_BASE_URL="http://localhost:3001", PROCESSING_SECRET="")
    with pytest.raises(RuntimeError) as exc:
        cfg.validar_config()
    mensaje = str(exc.value)
    assert "APP_BASE_URL" in mensaje and "PROCESSING_SECRET" in mensaje and "R2 incompleto" in mensaje


def test_cada_variable_que_lee_el_worker_esta_en_env_example():
    # Las que inyecta Railway no se cargan a mano.
    import pathlib
    import re

    raiz = pathlib.Path(__file__).resolve().parent.parent
    codigo = "".join(p.read_text(encoding="utf-8") for p in raiz.glob("*.py"))
    leidas = set(re.findall(r'os\.getenv\(\s*"([A-Z][A-Z0-9_]*)"', codigo))
    ejemplo = (raiz / ".env.example").read_text(encoding="utf-8")
    documentadas = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]*)=", ejemplo, re.MULTILINE))

    assert leidas - {n for n in leidas if n.startswith("RAILWAY_")} <= documentadas
    assert {"LLM_MAX_TOKENS_NOTA", "LLM_MAX_TOKENS_FEEDBACK", "LLM_MAX_TOKENS_REINTENTO", "PROMPTS_DIR", "WORKER_ID"} <= leidas


def test_los_techos_y_el_timeout_del_modelo_por_defecto(recargar_config, monkeypatch):
    # Con el entorno limpio de LLM_*: un valor exportado en el shell no
    # puede hacer pasar ni fallar este test.
    import os

    for clave in [c for c in os.environ if c.startswith("LLM_")]:
        monkeypatch.delenv(clave)
    c = recargar_config()

    assert c.LLM_MAX_TOKENS == 8192
    # 2026-09-19: la nota salio del techo comun (llm_truncado en una sesion
    # de 21 min). 2026-09-07: el feedback, por lo mismo.
    assert c.LLM_MAX_TOKENS_NOTA == 16384 > c.LLM_MAX_TOKENS
    assert c.LLM_MAX_TOKENS_FEEDBACK == 16384
    assert c.LLM_MAX_TOKENS_REINTENTO == 20480
    assert c.LLM_TIMEOUT_SECONDS == 600
    # Sin streaming, la segunda pasada tiene que terminar dentro del timeout
    # a una velocidad conservadora de 35 tok/s (ver config.py).
    assert c.LLM_TIMEOUT_SECONDS >= c.LLM_MAX_TOKENS_REINTENTO / 35

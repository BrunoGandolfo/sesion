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

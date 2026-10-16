"""
Lo que entra en la imagen del worker (Dockerfile: COPY . .) y lo que git ignora.

Los tests no se publican: no los importa el worker y algunos leen archivos
de afuera de processor/ (.github, src/). Los patrones de processor/.gitignore
son relativos a processor/: uno que empiece con "processor/" no coincide nunca.
"""
from pathlib import Path

RAIZ_WORKER = Path(__file__).resolve().parent.parent


def _patrones(nombre: str) -> list[str]:
    lineas = (RAIZ_WORKER / nombre).read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lineas if l.strip() and not l.startswith("#")]


def test_la_imagen_no_lleva_los_tests():
    patrones = _patrones(".dockerignore")
    assert "tests/" in patrones
    assert "conftest.py" in patrones


def test_la_imagen_lleva_los_contratos_con_la_app():
    assert not any(p.startswith("contrato") for p in _patrones(".dockerignore"))


def test_los_patrones_de_gitignore_son_relativos_a_processor():
    assert not [p for p in _patrones(".gitignore") if p.startswith("processor/")]

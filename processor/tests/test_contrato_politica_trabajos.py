"""
Los tiempos de reintento del borrado del transcript: contrato/politica-trabajos.json.

El worker decide cuándo un intento de borrar_transcript_asr ya no puede pisar
al worker dueño que todavía espera el transcript (trabajos.primer_intento_que_borra).
Ese cálculo depende del backoff y del lease que aplica la APP
(src/app/api/_lib/casos-uso/trabajos/politica.ts). Si la app acorta el
backoff y el worker no se entera, el trabajo puede borrar un transcript que
otro worker está por leer: un 404 que se clasifica como definitivo.

La app lee los tiempos de este contrato (politica.ts importa el JSON). Este
test lee politica.ts del disco y exige que lo siga leyendo. CI hace checkout
del repo entero, así que el archivo está.
"""
import json
import re
from pathlib import Path

import pytest

import trabajos

RAIZ = Path(__file__).resolve().parents[2]
POLITICA_TS = RAIZ / "src" / "app" / "api" / "_lib" / "casos-uso" / "trabajos" / "politica.ts"
CONTRATO = Path(__file__).resolve().parent.parent / "contrato" / "politica-trabajos.json"


def _app_lee_el_contrato() -> bool:
    """politica.ts toma el backoff y el lease de este mismo archivo (F2): no
    hay una segunda copia que comparar, sólo que siga leyéndolo."""
    fuente = POLITICA_TS.read_text(encoding="utf-8")
    return (
        "processor/contrato/politica-trabajos.json" in fuente
        and "contratoTrabajos.borrarTranscriptAsr.backoffSeg" in fuente
        and "contratoTrabajos.borrarTranscriptAsr.leaseWorkerSeg" in fuente
    )


def _contrato() -> dict:
    return json.loads(CONTRATO.read_text(encoding="utf-8"))["borrarTranscriptAsr"]


def test_la_politica_de_la_app_lee_el_contrato():
    assert _app_lee_el_contrato(), "politica.ts dejó de leer politica-trabajos.json"


def test_el_worker_usa_los_tiempos_del_contrato():
    contrato = _contrato()
    assert trabajos.BACKOFF_BORRADO_ASR_SEG == tuple(contrato["backoffSeg"])
    assert trabajos.LEASE_TRABAJO_WORKER_SEG == contrato["leaseWorkerSeg"]
    assert trabajos.RUTA_POLITICA_TRABAJOS == CONTRATO


def test_un_contrato_sin_los_tiempos_no_deja_arrancar(tmp_path):
    roto = tmp_path / "politica-trabajos.json"
    roto.write_text('{"borrarTranscriptAsr": {"backoffSeg": []}}', encoding="utf-8")
    with pytest.raises(ValueError):
        trabajos.cargar_politica_borrado_asr(roto)


CREAR_TS = RAIZ / "src" / "app" / "api" / "_lib" / "casos-uso" / "trabajos" / "crear.ts"


def test_el_worker_ejecuta_exactamente_los_tipos_que_la_app_le_asigna():
    fuente = CREAR_TS.read_text(encoding="utf-8")
    bloque = re.search(r"EJECUTOR_DE_TIPO[^=]*=\s*\{([^}]*)\}", fuente)
    assert bloque, "crear.ts cambió de forma: actualizar este test"
    del_worker = {tipo for tipo, ejecutor in re.findall(r"(\w+):\s*\"(\w+)\"", bloque.group(1)) if ejecutor == "worker"}
    assert set(trabajos.EJECUTORES) == del_worker
    assert trabajos.TIPOS_TRABAJO == list(trabajos.EJECUTORES)


def test_los_trabajos_viven_fuera_del_pipeline_de_sesion():
    import processor
    for nombre in ("ejecutar_trabajo", "borrar_transcript_asr", "generar_feedback", "integrar_contexto", "TIPOS_TRABAJO"):
        assert not hasattr(processor, nombre), nombre

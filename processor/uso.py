"""
Consumo y diagnostico de una corrida: lo que viaja como `uso` en cada
resultado de sesion (POST /api/sesion-clinica/[id]/resultado) y de trabajo
(POST /api/trabajos/[id]/resultado), con la forma de usoSchema
(src/lib/sesion-clinica/schema.ts):

    {
      "worker": "1a2b3c4",            # config.WORKER_VERSION
      "asrSegundos": 3232,            # lo que informo (y factura) AssemblyAI
      "pasosMs": {"descarga": 812, "normalizacion": 61234, "asr": 245000},
      "llamadas": [{"nombre": "nota#1", "entrada": ..., "salida": ...,
                    "cacheLectura": 0, "cacheEscritura": 0,
                    "razonamiento": ..., "techo": 16384, "stop": "end_turn",
                    "ms": 83000, "requestId": "req_..."}],
      "reintentos": 0,                # segundas pasadas por forma
      "advertencias": []              # saneo de escalas (schemas_llm)
    }

La app lo guarda en la columna `uso` SIN cifrar. Por eso aca solo entran
numeros, codigos, nombres de paso e ids de pedido: nunca texto de la sesion.
Las advertencias ya vienen asi de schemas_llm (_para_advertencia).
"""
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

import config

logger = logging.getLogger(__name__)


def ms_desde(inicio: float) -> int:
    """Milisegundos desde `inicio` (un time.monotonic())."""
    return int(round((time.monotonic() - inicio) * 1000))


@dataclass
class Uso:
    asr_segundos: int | None = None
    pasos_ms: dict[str, int] = field(default_factory=dict)
    # Una entrada por pedido a Anthropic, la arma clinical_analyzer.
    llamadas: list[dict] = field(default_factory=list)
    advertencias: list[str] = field(default_factory=list)

    @contextmanager
    def medir(self, paso: str, etiqueta: str = "") -> Iterator[None]:
        """Mide un paso con time.monotonic(); queda anotado aunque falle."""
        inicio = time.monotonic()
        try:
            yield
        finally:
            self.pasos_ms[paso] = ms_desde(inicio)
            prefijo = f"[{etiqueta}] " if etiqueta else ""
            logger.info(f"{prefijo}paso {paso}: {self.pasos_ms[paso]} ms")

    @property
    def reintentos(self) -> int:
        """Segundas pasadas: toda llamada que no es la #1 de su nombre."""
        return sum(1 for llamada in self.llamadas if not llamada["nombre"].endswith("#1"))

    def payload(self) -> dict:
        datos: dict = {
            "worker": config.WORKER_VERSION,
            "llamadas": [dict(llamada) for llamada in self.llamadas],
            "reintentos": self.reintentos,
            "advertencias": list(self.advertencias),
        }
        if self.asr_segundos is not None:
            datos["asrSegundos"] = self.asr_segundos
        if self.pasos_ms:
            datos["pasosMs"] = dict(self.pasos_ms)
        return datos

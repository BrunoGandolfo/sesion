"""
Dobles y datos compartidos por los tests del worker. Sin red.

- RIESGO_SIN_SEÑAL y nota(): una salida de la Llamada A que cumple
  validar_estructura_nota.
- respuesta_sdk(): lo que devuelve messages.create del SDK de Anthropic 1.x,
  con los campos que lee clinical_analyzer._llamar_anthropic.
- requiere(): salta un test que necesita una herramienta del sistema (node,
  ffmpeg) cuando falta, salvo en CI: ahi tiene que estar, y si falta el test
  falla en vez de desaparecer en silencio.
"""
import json
import os
import shutil
from types import SimpleNamespace

import pytest

RIESGO_SIN_SEÑAL = {
    "nivel": "ninguno",
    "indicadores": [],
    "evidencia": [],
    "notaParaTerapeuta": None,
}


def nota(**datos) -> dict:
    """Nota estructuralmente valida; `datos` pisa datosEstructurados."""
    base = {
        "intensidadEmocional": 7,
        "alianzaTerapeutica": "estable",
        "duracionRealMin": 50,
        "riesgoDetectado": dict(RIESGO_SIN_SEÑAL),
    }
    base.update(datos)
    return {
        "nota": {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
        "datosEstructurados": base,
    }


def respuesta_sdk(
    cuerpo: dict | str,
    stop: str = "end_turn",
    entrada: int = 21000,
    salida: int = 9000,
    razonamiento: int | None = 6500,
    request_id: str | None = "req_01",
):
    """
    Lo que devuelve messages.create del SDK 1.x. `cuerpo` va como el unico
    bloque de texto (un dict se serializa); `razonamiento=None` es una
    respuesta que no informa thinking_tokens.
    """
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


def requiere(*programas: str):
    """skipif para tests que llaman a `programas`: solo fuera de CI."""
    faltan = [p for p in programas if shutil.which(p) is None]
    return pytest.mark.skipif(
        bool(faltan) and not os.getenv("CI"),
        reason=f"falta {', '.join(faltan)} (en CI no se saltea)",
    )

"""Menciones literales para revisión humana. No interpreta ni gradúa riesgo.

Lista deliberadamente corta y versionada, tomada del diseño 04. Una negación
también se muestra: decidir su sentido corresponde a la profesional. No detecta
todas las expresiones posibles y la ausencia de coincidencias no evalúa riesgo.
"""
import re

VERSION = "1"
TERMINOS = (
    "matarme", "quitarme la vida", "no quiero vivir", "lastimarme", "cortarme",
    "pastillas para dormir para siempre",
)
PATRON = re.compile(r"\b(?:" + "|".join(r"\s+".join(map(re.escape, t.split())) for t in TERMINOS) + r")\b", re.IGNORECASE)
TIMESTAMP = re.compile(r"^\[(\d{2,}:\d{2}(?::\d{2})?)\]")


def buscar_menciones(transcripcion: str) -> dict:
    coincidencias = []
    for linea in transcripcion.splitlines():
        timestamp = TIMESTAMP.match(linea)
        for match in PATRON.finditer(linea):
            coincidencias.append({
                "termino": " ".join(match.group().lower().split()),
                "timestamp": timestamp.group(1) if timestamp else None,
                "quote": linea[max(0, match.start() - 120):match.end() + 120].strip(),
            })
    return {"version": VERSION, "coincidencias": coincidencias}

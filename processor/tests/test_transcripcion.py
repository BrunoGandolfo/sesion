"""
Contrato del texto de la transcripcion: lo que ve cada prompt y lo que la app
guarda y parte en bloques (src/app/(dashboard)/sesiones/[id]/_components/
transcripcion.ts). Mismos casos que su test,
_components/__tests__/transcripcion.test.ts: si este formato cambia, la
pantalla deja de reconocer los turnos sin que falle nada en Python.
"""
import re

from transcripcion import formatear_para_llm

# La expresion de transcripcion.ts (LINEA), tal cual.
LINEA_APP = re.compile(r"^\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^:\[\]]{1,40}):\s?(.*)$")


def _seg(speaker: str, start: float, text: str) -> dict:
    return {"speaker": speaker, "start": start, "end": start + 1, "text": text}


def leer_como_la_app(texto: str) -> list[dict]:
    bloques = []
    for linea in re.split(r"\r?\n", texto):
        if not linea.strip():
            continue
        m = LINEA_APP.match(linea)
        bloques.append(
            {"tipo": "turno", "marca": m[1], "hablante": m[2].strip(), "texto": m[3]}
            if m
            else {"tipo": "literal", "texto": linea}
        )
    return bloques


def test_el_texto_del_worker_es_el_que_la_app_parte_en_turnos():
    texto = formatear_para_llm(
        {
            "segments": [
                _seg("S0", 3.4, "¿Cómo estuvo la semana?"),
                _seg("S1", 9.0, "Rara: dormí mal."),
                # Una sesion larga pasa de los 99 minutos.
                _seg("S0", 120 * 60 + 5.9, "Seguimos la próxima."),
            ]
        }
    )

    assert texto == (
        "[00:03] Terapeuta: ¿Cómo estuvo la semana?\n"
        "[00:09] Paciente: Rara: dormí mal.\n"
        "[120:05] Terapeuta: Seguimos la próxima."
    )
    assert leer_como_la_app(texto) == [
        {"tipo": "turno", "marca": "00:03", "hablante": "Terapeuta", "texto": "¿Cómo estuvo la semana?"},
        # Los dos puntos de adentro del texto son texto.
        {"tipo": "turno", "marca": "00:09", "hablante": "Paciente", "texto": "Rara: dormí mal."},
        {"tipo": "turno", "marca": "120:05", "hablante": "Terapeuta", "texto": "Seguimos la próxima."},
    ]


def test_s0_es_terapeuta_y_cualquier_otro_hablante_es_paciente():
    # La app numera "Terapeuta" como Hablante 1 y "Paciente" como 2; un rotulo
    # distinto no tendria numero.
    texto = formatear_para_llm({"segments": [_seg("S0", 0, "a"), _seg("S1", 1, "b"), _seg("S2", 2, "c")]})
    assert [b["hablante"] for b in leer_como_la_app(texto)] == ["Terapeuta", "Paciente", "Paciente"]


def test_sin_segmentos_no_hay_texto():
    assert formatear_para_llm({"segments": []}) == ""
    assert formatear_para_llm({}) == ""

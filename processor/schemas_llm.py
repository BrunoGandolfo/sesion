"""
JSON Schemas para structured outputs de Anthropic, derivados de los
<output_schema> de los prompts en prompts/.

Reglas de structured outputs que respetan todos los schemas:
- todo objeto lleva additionalProperties=false y required con TODAS sus
  propiedades;
- sin minimum/maximum/minLength/maxLength (los rangos numéricos se validan
  en código, ver validar_rangos_nota);
- nullable expresado como {"type": ["string", "null"]};
- enums solo de primitivos, sin $ref.

Sin contenido clínico en descripciones: solo nombres técnicos de propiedades
y enums de valores fijos.
"""

# Helpers ───────────────────────────────────────────────────────────────────

_STR = {"type": "string"}
_STR_NULL = {"type": ["string", "null"]}
_INT = {"type": "integer"}
_INT_NULL = {"type": ["integer", "null"]}
_NUM_NULL = {"type": ["number", "null"]}
_BOOL = {"type": "boolean"}


def _obj(props: dict) -> dict:
    return {
        "type": "object",
        "properties": props,
        "required": list(props.keys()),
        "additionalProperties": False,
    }


def _arr(items: dict) -> dict:
    return {"type": "array", "items": items}


def _enum(*valores: str) -> dict:
    return {"type": "string", "enum": list(valores)}


def _enum_null(*valores: str) -> dict:
    """
    Enum que admite null. Structured outputs exige que TODA propiedad este en
    `required`, asi que un campo "sin dato" no se puede omitir: se declara
    nullable y el modelo dice null en vez de inventar un valor de la escala.
    """
    return {"type": ["string", "null"], "enum": [*valores, None]}


# Fragmentos compartidos ────────────────────────────────────────────────────

TIPOS_INTERVENCION = (
    "reformulacion",
    "senalamiento",
    "confrontacion",
    "interpretacion",
    "pregunta_circular",
    "validacion",
    "silencio_terapeutico",
    "otra",
)

FLAGS_RIESGO = (
    "ideacionSuicida",
    "autolesion",
    "violenciaTerceros",
    "sintomasPsicoticos",
    "crisisPanico",
)

# {timestamp, quote}: cita anclada en la transcripción.
_EVIDENCIA = _arr(_obj({"timestamp": _STR, "quote": _STR}))

# Score con evidencia y razón (score null cuando no es determinable).
_SCORE_CON_EVIDENCIA = _obj({
    "score": _INT_NULL,
    "evidence": _EVIDENCIA,
    "razon": _STR_NULL,
})

_FORTALEZAS = _arr(_obj({"descripcion": _STR, "evidence": _EVIDENCIA}))
_AREAS_CRECIMIENTO = _arr(_obj({
    "observacion": _STR,
    "sugerencia": _STR,
    "evidence": _EVIDENCIA,
}))
_SPEECH_ANALYTICS_INFERIDO = _obj({
    "ratioHablaTerapeutaPaciente": _NUM_NULL,
    "comentario": _STR_NULL,
})

# Nota clínica SOAP — clinical_note_v3.1.md ─────────────────────────────────

SCHEMA_NOTA = _obj({
    "nota": _obj({
        "subjetivo": _STR,
        "objetivo": _STR,
        "analisis": _STR,
        "plan": _STR,
    }),
    "datosEstructurados": _obj({
        "resumenSesion": _STR,
        "estadoEmocionalObservado": _STR,
        "temas": _arr(_STR),
        "emocionesPaciente": _arr(_STR),
        # Nullables a proposito (ver sanear_datos_nota): son escalas de
        # valoracion, no hechos. Sin material para evaluarlas el modelo dice
        # null en vez de inventar un 0 que despues se grafica como medicion.
        "intensidadEmocional": _INT_NULL,
        "alianzaTerapeutica": _enum_null("fragil", "inestable", "estable", "fuerte"),
        "intervenciones": _arr(_obj({
            "tipo": _enum(*TIPOS_INTERVENCION),
            "descripcion": _STR,
            "timestampAprox": _STR,
        })),
        "compromisos": _arr(_STR),
        "materialRecurrente": _arr(_STR),
        "materialNuevo": _arr(_STR),
        "focoProximaSesion": _STR,
        "progresoPercibido": _STR,
        "flagsRiesgo": _obj({
            "ideacionSuicida": _BOOL,
            "autolesion": _BOOL,
            "violenciaTerceros": _BOOL,
            "sintomasPsicoticos": _BOOL,
            "crisisPanico": _BOOL,
            "detalle": _STR,
        }),
        "riesgoDetectado": _obj({
            "nivel": _enum("ninguno", "bajo", "moderado", "alto"),
            "indicadores": _arr(_STR),
            "evidencia": _EVIDENCIA,
            "notaParaTerapeuta": _STR_NULL,
        }),
        "confianzaModelo": _enum("alta", "media", "baja"),
        "duracionRealMin": _INT_NULL,
        "observacionIA": _STR,
    }),
})

# Contexto clínico longitudinal — update_context_v2.0.md ────────────────────

SCHEMA_CONTEXTO = _obj({
    "hipotesisDiagnostica": _STR_NULL,
    "resumenAcumulativo": _STR_NULL,
    "objetivosTerapeuticos": _arr(_obj({
        "id": _STR,
        "descripcion": _STR,
        "estado": _enum("activo", "cerrado", "pausado"),
        "fechaInicio": _STR,
        "fechaCierre": _STR_NULL,
    })),
    "intervencionesProbadas": _arr(_obj({
        "tecnica": _enum(*TIPOS_INTERVENCION),
        "eficaciaPercibida": _enum("alta", "media", "baja"),
        "sesiones": _arr(_INT),
    })),
    "temasRecurrentes": _arr(_obj({"tema": _STR, "conteo": _INT})),
    "riesgosHistoricos": _arr(_obj({
        "sesionId": _STR,
        "fecha": _STR,
        "flag": _enum(*FLAGS_RIESGO),
        "detalle": _STR,
    })),
    "ultimaSesionId": _STR,
})

# Feedback terapeuta CBT/MI — therapist_feedback_v1.0.md ────────────────────

DISCLAIMER_CBT_MI = (
    "Estas métricas son orientativas, derivadas de la transcripción de audio. "
    "No reemplazan supervisión clínica profesional ni constituyen evaluación "
    "formal de competencia."
)

_BENCHMARK = _enum("insufficient", "fair", "good")

SCHEMA_FEEDBACK_CBT_MI = _obj({
    "mitiGlobales": _obj({
        "cultivatingChangeTalk": _SCORE_CON_EVIDENCIA,
        "softeningSustainTalk": _SCORE_CON_EVIDENCIA,
        "partnership": _SCORE_CON_EVIDENCIA,
        "empathy": _SCORE_CON_EVIDENCIA,
    }),
    "mitiCounts": _obj({
        "Q": _INT,
        "SR": _INT,
        "CR": _INT,
        "AF": _INT,
        "SC": _INT,
        "EA": _INT,
        "GI": _INT,
        "PWP": _INT,
        "P": _INT,
        "C": _INT,
    }),
    "ratiosDerivados": _obj({
        "rq": _NUM_NULL,
        "porcentajeCR": _NUM_NULL,
        "benchmarkRQ": _BENCHMARK,
        "benchmarkPorcentajeCR": _BENCHMARK,
    }),
    "ctsrSubset": _obj({
        "agendaSetting": _SCORE_CON_EVIDENCIA,
        "feedback": _SCORE_CON_EVIDENCIA,
        "collaboration": _SCORE_CON_EVIDENCIA,
        "guidedDiscovery": _SCORE_CON_EVIDENCIA,
    }),
    "speechAnalyticsInferido": _SPEECH_ANALYTICS_INFERIDO,
    "fortalezas": _FORTALEZAS,
    "areasCrecimiento": _AREAS_CRECIMIENTO,
    "sugerenciaProximaSesion": _STR,
    "disclaimer": _enum(DISCLAIMER_CBT_MI),
})

# Feedback terapeuta Gestalt — therapist_feedback_gestalt_v1.0.md ───────────

DISCLAIMER_GESTALT = (
    "Este análisis fue generado por IA aplicando la Gestalt Therapy Fidelity "
    "Scale (GTFS) sobre la transcripción de la sesión. La GTFS mide adherencia "
    "al modelo gestáltico, no competencia clínica global. La escala fue "
    "validada para observación en video: la evaluación desde transcripción "
    "puede subestimar conductas no verbalizadas (especialmente el trabajo "
    "corporal). Las puntuaciones son orientativas y no sustituyen la "
    "supervisión clínica profesional."
)

IDS_GTFS = tuple(f"gtfs_{n:02d}" for n in range(1, 21))

SCHEMA_FEEDBACK_GESTALT = _obj({
    "instrumento": _enum("gestalt"),
    "itemsGTFS": _arr(_obj({
        "id": _enum(*IDS_GTFS),
        "nombre": _STR,
        "score": _INT_NULL,
        "razon": _STR_NULL,
        "evidence": _EVIDENCIA,
    })),
    "adherenciaGlobal": _INT,
    "fortalezas": _FORTALEZAS,
    "areasCrecimiento": _AREAS_CRECIMIENTO,
    "sugerenciaProximaSesion": _STR,
    "speechAnalyticsInferido": _SPEECH_ANALYTICS_INFERIDO,
    "disclaimer": _enum(DISCLAIMER_GESTALT),
})


# ────────────────────────────────────────────────────────────────────────────
# Dos niveles de control sobre la salida del LLM, con consecuencias distintas.
#
#   validar_estructura_*  BLOQUEANTE. Lo que hace que la sesion sea una sesion:
#                         JSON parseable, las cuatro secciones SOAP con texto,
#                         y la señal de riesgo bien formada si viene. Lanza
#                         ValueError; clinical_analyzer lo usa para pedirle al
#                         modelo una segunda pasada, y si tampoco valida,
#                         recien ahi falla la sesion.
#
#   sanear_*              NO BLOQUEANTE. Escalas de valoracion secundarias
#                         (intensidad, alianza, duracion, puntajes de items).
#                         Un valor fuera de rango se descarta y queda una
#                         advertencia; la sesion sigue.
#
# El porque de la asimetria: el 4/9 una sesion breve volvio con
# intensidadEmocional=0 y el validador tiro abajo la nota entera. La terapeuta
# perdio la nota de una sesion que ya habia ocurrido y tuvo que apretar
# Reintentar. Ningun campo numerico secundario justifica eso.
#
# Por que se DESCARTA la clave en vez de mandarla en null: el contrato de la
# app (src/lib/sesion-clinica/schema.ts:125,126,143) declara estos tres campos
# como `.optional()`, no `.nullable()`. Un null explicito hace fallar la
# validacion Zod del callback y devuelve 400, que para el worker es terminal
# (processor/callback.py no reintenta ante 4xx). Omitir la clave es lo unico
# que la app acepta como "este dato no esta".
# ────────────────────────────────────────────────────────────────────────────

SECCIONES_SOAP = ("subjetivo", "objetivo", "analisis", "plan")
NIVELES_RIESGO = ("ninguno", "bajo", "moderado", "alto")
ALIANZAS = ("fragil", "inestable", "estable", "fuerte")

RANGO_INTENSIDAD = (1, 10)
# Escalas de los puntajes por item de cada instrumento de feedback.
RANGO_MITI_GLOBAL = (1, 5)
RANGO_CTSR = (0, 6)
RANGO_GTFS = (0, 1)


def _es_entero(valor: object) -> bool:
    """bool es subclase de int en Python; un True no es un puntaje."""
    return isinstance(valor, int) and not isinstance(valor, bool)


def _para_advertencia(valor: object) -> str:
    """
    Representacion segura del valor rechazado. Numeros y booleanos se muestran
    tal cual; cualquier otra cosa se reduce al tipo. Las advertencias se
    persisten en la base y no tienen por que arrastrar texto del modelo.
    """
    if valor is None or isinstance(valor, (int, float, bool)):
        return repr(valor)
    return f"<{type(valor).__name__}>"


# Estructura — bloqueante ───────────────────────────────────────────────────

def _exigir_claves(objeto: object, claves: tuple[str, ...], que: str) -> dict:
    if not isinstance(objeto, dict):
        raise ValueError(f"{que}: la respuesta no es un objeto JSON")
    faltantes = [c for c in claves if c not in objeto]
    if faltantes:
        raise ValueError(f"{que}: faltan las claves {', '.join(faltantes)}")
    return objeto


def _validar_riesgo_detectado(riesgo: object) -> None:
    """
    La señal de riesgo es bloqueante por decision clinica: una señal mal
    formada que se descarta en silencio es exactamente el fallo que no
    queremos. Si viene, viene bien; si no hay señal, viene con nivel
    "ninguno", que es informacion afirmativa.
    """
    if not isinstance(riesgo, dict):
        raise ValueError("riesgoDetectado no es un objeto")
    if riesgo.get("nivel") not in NIVELES_RIESGO:
        raise ValueError(
            "riesgoDetectado.nivel debe ser uno de: " + ", ".join(NIVELES_RIESGO)
        )
    if not isinstance(riesgo.get("indicadores"), list):
        raise ValueError("riesgoDetectado.indicadores no es una lista")

    evidencia = riesgo.get("evidencia")
    if not isinstance(evidencia, list):
        raise ValueError("riesgoDetectado.evidencia no es una lista")
    for i, entrada in enumerate(evidencia):
        if (
            not isinstance(entrada, dict)
            or not isinstance(entrada.get("timestamp"), str)
            or not isinstance(entrada.get("quote"), str)
        ):
            raise ValueError(
                f"riesgoDetectado.evidencia[{i}] debe tener timestamp y quote de texto"
            )

    nota_terapeuta = riesgo.get("notaParaTerapeuta")
    if nota_terapeuta is not None and not isinstance(nota_terapeuta, str):
        raise ValueError("riesgoDetectado.notaParaTerapeuta debe ser texto o null")


def validar_estructura_nota(resultado: object) -> None:
    """
    Bloqueante. Los mensajes son de forma (nombres de campo y tipos), nunca
    contenido: se le citan al modelo en el reintento y quedan en los logs.
    """
    datos_y_nota = _exigir_claves(resultado, ("nota", "datosEstructurados"), "nota clinica")

    nota = datos_y_nota["nota"]
    if not isinstance(nota, dict):
        raise ValueError("nota clinica: 'nota' no es un objeto")
    vacias = [
        seccion
        for seccion in SECCIONES_SOAP
        if not isinstance(nota.get(seccion), str) or not nota[seccion].strip()
    ]
    if vacias:
        raise ValueError(
            "nota clinica: las secciones SOAP " + ", ".join(vacias) + " estan vacias o ausentes"
        )

    datos = datos_y_nota["datosEstructurados"]
    if not isinstance(datos, dict):
        raise ValueError("nota clinica: 'datosEstructurados' no es un objeto")

    if "riesgoDetectado" in datos and datos["riesgoDetectado"] is not None:
        _validar_riesgo_detectado(datos["riesgoDetectado"])


def validar_estructura_feedback_cbt_mi(feedback: object) -> None:
    _exigir_claves(
        feedback,
        ("mitiGlobales", "mitiCounts", "ctsrSubset", "fortalezas", "areasCrecimiento"),
        "feedback CBT/MI",
    )


def validar_estructura_feedback_gestalt(feedback: object) -> None:
    datos = _exigir_claves(
        feedback,
        ("instrumento", "itemsGTFS", "fortalezas", "areasCrecimiento"),
        "feedback Gestalt",
    )
    items = datos["itemsGTFS"]
    if not isinstance(items, list) or not items:
        raise ValueError("feedback Gestalt: itemsGTFS esta vacio o no es una lista")


def validar_estructura_contexto(contexto: object) -> None:
    _exigir_claves(
        contexto,
        (
            "hipotesisDiagnostica",
            "resumenAcumulativo",
            "objetivosTerapeuticos",
            "intervencionesProbadas",
            "temasRecurrentes",
            "riesgosHistoricos",
        ),
        "contexto clinico",
    )


# Saneo de escalas — no bloqueante ──────────────────────────────────────────

def _sanear_entero_en_rango(
    contenedor: dict,
    clave: str,
    rango: tuple[int, int],
    advertencias: list[str],
    *,
    quitar: bool,
) -> None:
    """
    Deja `clave` con un entero dentro de `rango`, o sin valor. `quitar=True`
    elimina la clave (contrato de la nota, que la app valida como opcional);
    `quitar=False` la deja en None (feedback, que la app pasa opaco y la UI
    ya renderiza como "No determinable").
    """
    if clave not in contenedor:
        return

    valor = contenedor[clave]
    if valor is None:
        if quitar:
            contenedor.pop(clave, None)
        return

    minimo, maximo = rango
    if _es_entero(valor) and minimo <= valor <= maximo:
        return

    advertencias.append(
        f"{clave}={_para_advertencia(valor)} fuera de rango {minimo}..{maximo}, anulado"
    )
    if quitar:
        contenedor.pop(clave, None)
    else:
        contenedor[clave] = None


def sanear_datos_nota(resultado: dict) -> list[str]:
    """
    Normaliza las tres escalas de valoracion de la nota. Nunca lanza: devuelve
    la lista de advertencias que el pipeline guarda en
    datosEstructurados._pipeline.advertencias.
    """
    advertencias: list[str] = []
    datos = resultado.get("datosEstructurados")
    if not isinstance(datos, dict):
        # Caso ya cubierto por validar_estructura_nota; aca no hay nada que sanear.
        return advertencias

    _sanear_entero_en_rango(
        datos, "intensidadEmocional", RANGO_INTENSIDAD, advertencias, quitar=True
    )

    if "duracionRealMin" in datos:
        duracion = datos["duracionRealMin"]
        if duracion is None:
            datos.pop("duracionRealMin", None)
        elif not _es_entero(duracion) or duracion < 0:
            advertencias.append(
                f"duracionRealMin={_para_advertencia(duracion)} invalido, anulado"
            )
            datos.pop("duracionRealMin", None)

    if "alianzaTerapeutica" in datos:
        alianza = datos["alianzaTerapeutica"]
        if alianza is None:
            datos.pop("alianzaTerapeutica", None)
        elif alianza not in ALIANZAS:
            # Sin eco del valor: el enum es cerrado y lo que venga fuera de el
            # es texto del modelo.
            advertencias.append("alianzaTerapeutica fuera del enum, anulado")
            datos.pop("alianzaTerapeutica", None)

    return advertencias


def sanear_feedback(feedback: dict, orientacion: str) -> list[str]:
    """
    Normaliza los puntajes por item del reporte de auto-supervision. Un
    puntaje fuera de escala se pone en None (la UI lo muestra como "No
    determinable") en vez de dibujar una barra imposible.
    """
    advertencias: list[str] = []
    if not isinstance(feedback, dict):
        return advertencias

    if orientacion == "gestalt":
        items = feedback.get("itemsGTFS")
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                _sanear_entero_en_rango(
                    item, "score", RANGO_GTFS, advertencias, quitar=False
                )
        return advertencias

    for bloque, rango in (("mitiGlobales", RANGO_MITI_GLOBAL), ("ctsrSubset", RANGO_CTSR)):
        contenido = feedback.get(bloque)
        if not isinstance(contenido, dict):
            continue
        for nombre, item in contenido.items():
            if not isinstance(item, dict):
                continue
            antes = len(advertencias)
            _sanear_entero_en_rango(item, "score", rango, advertencias, quitar=False)
            # El campo se llama "score" en los cuatro items de cada bloque:
            # sin el prefijo la advertencia no dice cual fue.
            for i in range(antes, len(advertencias)):
                advertencias[i] = f"{bloque}.{nombre}.{advertencias[i]}"

    return advertencias

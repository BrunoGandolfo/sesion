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
        "intensidadEmocional": _INT,
        "alianzaTerapeutica": _enum("fragil", "inestable", "estable", "fuerte"),
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
        "duracionRealMin": _INT,
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


# Validaciones de rango (no expresables en el schema) ───────────────────────

def validar_rangos_nota(resultado: dict) -> None:
    """
    Verifica en código los rangos que el schema no puede expresar:
    intensidadEmocional en 1..10 y duracionRealMin >= 0. Lanza ValueError.
    """
    datos = resultado.get("datosEstructurados")
    if not isinstance(datos, dict):
        raise ValueError("datosEstructurados ausente o no es objeto")

    intensidad = datos.get("intensidadEmocional")
    if not isinstance(intensidad, int) or isinstance(intensidad, bool):
        raise ValueError("intensidadEmocional no es entero")
    if not 1 <= intensidad <= 10:
        raise ValueError(f"intensidadEmocional fuera de rango 1..10: {intensidad}")

    duracion = datos.get("duracionRealMin")
    if not isinstance(duracion, int) or isinstance(duracion, bool):
        raise ValueError("duracionRealMin no es entero")
    if duracion < 0:
        raise ValueError(f"duracionRealMin negativo: {duracion}")

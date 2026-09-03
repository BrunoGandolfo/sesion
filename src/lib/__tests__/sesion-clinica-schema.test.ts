import { describe, it, expect } from "vitest";

import {
  datosEstructuradosSchema,
  notaSoapSchema,
  parseDatosEstructurados,
  sesionClinicaResponseSchema,
} from "@/lib/sesion-clinica/schema";

// Payload realista de `datosEstructurados` tal como lo manda el worker al
// callback (src/app/api/sesion-clinica/callback/route.ts), con todos los
// bloques opcionales presentes.
const datosCallbackCompletos = {
  temas: ["ansiedad", "trabajo"],
  emocionesPaciente: ["frustración", "alivio"],
  intensidadEmocional: 7,
  alianzaTerapeutica: "estable",
  intervenciones: [
    {
      tipo: "validacion",
      descripcion: "Valida la angustia y ordena la secuencia del relato.",
      timestampAprox: "12:34",
    },
    {
      tipo: "reformulacion",
      descripcion: "Reformula el conflicto laboral en términos de exigencia.",
    },
  ],
  compromisos: ["registro diario de disparadores"],
  progresoPercibido: "leve mejora",
  materialRecurrente: ["exigencia laboral"],
  materialNuevo: ["conflicto con supervisión"],
  focoProximaSesion: "Explorar autoexigencia y anticipación ansiosa.",
  flagsRiesgo: {
    ideacionSuicida: false,
    autolesion: false,
    violenciaTerceros: false,
    sintomasPsicoticos: false,
    crisisPanico: false,
    detalle: "",
  },
  riesgoDetectado: {
    nivel: "bajo",
    indicadores: ["desesperanza pasajera"],
    evidencia: [{ timestamp: "21:10", quote: "a veces siento que no avanzo" }],
    notaParaTerapeuta: "Señal leve; conviene retomarla la próxima sesión.",
  },
  feedbackTerapeuta: {
    instrumento: "cbt_mi",
    fortalezas: [],
    areasCrecimiento: [],
    sugerenciaProximaSesion: "Sostener preguntas abiertas.",
    disclaimer: "Auto-supervisión asistida.",
  },
  confianzaModelo: "media",
  resumenSesion: "Se trabajó ansiedad laboral con registro de disparadores.",
  estadoEmocionalObservado: "Tono ansioso con momentos de alivio.",
  duracionRealMin: 50,
  speechAnalytics: {
    ratioHablaTerapeuta: 38,
    ratioHablaPaciente: 62,
    cantidadSilencios: 8,
    duracionPromedioSilenciosSeg: 6,
    tiempoTotalHablaSeg: 2880,
    speakersDetectados: 2,
    rolesOrigen: "asr_role",
  },
  observacionIA: "Descenso sostenido de la intensidad emocional.",
  _pipeline: { intento: 1, promptVersion: "v2.1" },
};

describe("notaSoapSchema", () => {
  it("acepta las cuatro secciones como string", () => {
    const nota = {
      subjetivo: "Refiere ansiedad.",
      objetivo: "Contacto visual sostenido.",
      analisis: "Alianza estable.",
      plan: "Continuar TCC.",
    };
    expect(notaSoapSchema.parse(nota)).toEqual(nota);
  });

  it("rechaza una nota sin plan", () => {
    const sinPlan = { subjetivo: "s", objetivo: "o", analisis: "a" };
    expect(notaSoapSchema.safeParse(sinPlan).success).toBe(false);
  });
});

describe("datosEstructuradosSchema", () => {
  it("acepta el payload completo del callback", () => {
    const resultado = datosEstructuradosSchema.safeParse(datosCallbackCompletos);
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.speechAnalytics?.rolesOrigen).toBe("asr_role");
      expect(resultado.data.riesgoDetectado?.nivel).toBe("bajo");
      expect(resultado.data._pipeline).toEqual({ intento: 1, promptVersion: "v2.1" });
      expect(resultado.data.intervenciones?.[1]?.timestampAprox).toBeUndefined();
    }
  });

  it("acepta datos parciales (todo es opcional)", () => {
    expect(datosEstructuradosSchema.safeParse({}).success).toBe(true);
    expect(
      datosEstructuradosSchema.safeParse({ temas: ["ansiedad"] }).success,
    ).toBe(true);
  });

  it("rechaza una intervención con tipo inválido", () => {
    const resultado = datosEstructuradosSchema.safeParse({
      intervenciones: [{ tipo: "psicoeducacion", descripcion: "x" }],
    });
    expect(resultado.success).toBe(false);
  });

  it("rechaza intensidadEmocional fuera de 1..10", () => {
    expect(
      datosEstructuradosSchema.safeParse({ intensidadEmocional: 0 }).success,
    ).toBe(false);
    expect(
      datosEstructuradosSchema.safeParse({ intensidadEmocional: 11 }).success,
    ).toBe(false);
  });

  it("descarta un riesgoDetectado con shape inválido sin invalidar el objeto", () => {
    const resultado = datosEstructuradosSchema.safeParse({
      temas: ["x"],
      riesgoDetectado: { nivel: "critico" },
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.riesgoDetectado).toBeUndefined();
      expect(resultado.data.temas).toEqual(["x"]);
    }
  });

  it("descarta claves desconocidas como _audioCifradoTemporal", () => {
    const resultado = datosEstructuradosSchema.safeParse({
      temas: ["x"],
      _audioCifradoTemporal: { claveCifrado: "k", ivCifrado: "iv" },
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data).not.toHaveProperty("_audioCifradoTemporal");
    }
  });
});

describe("parseDatosEstructurados", () => {
  it("acepta un string JSON válido", () => {
    const parsed = parseDatosEstructurados(JSON.stringify(datosCallbackCompletos));
    expect(parsed).not.toBeNull();
    expect(parsed?.temas).toEqual(["ansiedad", "trabajo"]);
  });

  it("acepta el objeto ya deserializado", () => {
    expect(parseDatosEstructurados({ temas: ["x"] })).toEqual({ temas: ["x"] });
  });

  it("devuelve null ante string que no es JSON", () => {
    expect(parseDatosEstructurados("{ no es json")).toBeNull();
  });

  it("devuelve null ante basura que no valida", () => {
    expect(parseDatosEstructurados({ intervenciones: "no es array" })).toBeNull();
    expect(parseDatosEstructurados(42)).toBeNull();
    expect(parseDatosEstructurados([1, 2, 3])).toBeNull();
  });

  it("devuelve null ante null o undefined", () => {
    expect(parseDatosEstructurados(null)).toBeNull();
    expect(parseDatosEstructurados(undefined)).toBeNull();
  });

  it("nunca lanza", () => {
    expect(() => parseDatosEstructurados(Symbol("raro"))).not.toThrow();
  });
});

describe("sesionClinicaResponseSchema", () => {
  const base = {
    id: "ses1",
    turnoId: "tur1",
    estado: "revision",
    duracionAudioSeg: 3000,
    audioR2Key: "audio/org/ses1/tur1.enc",
    audioBorradoEn: null,
    notaSubjetivo: "s",
    notaObjetivo: "o",
    notaAnalisis: "a",
    notaPlan: "p",
    notaSoapOriginal: { subjetivo: "s", objetivo: null, analisis: "a", plan: "p" },
    datosEstructurados: { temas: ["x"] },
    modeloASR: "asr",
    modeloLLM: "llm",
    promptVersion: "v2.1",
    hablanteTerapeuta: "S0",
    procesadoEn: "2026-04-20T12:00:00.000Z",
    aprobadoEn: null,
    error: null,
    intentos: 1,
    createdAt: "2026-04-20T11:00:00.000Z",
    updatedAt: "2026-04-20T12:00:00.000Z",
  };

  it("acepta una respuesta sin turno", () => {
    expect(sesionClinicaResponseSchema.safeParse(base).success).toBe(true);
  });

  it("acepta turno mínimo con y sin teléfono", () => {
    const conTurno = {
      ...base,
      turno: {
        id: "tur1",
        fecha: "2026-04-20T10:00:00.000Z",
        paciente: { id: "p1", nombre: "Ana", apellido: "Pérez" },
      },
    };
    expect(sesionClinicaResponseSchema.safeParse(conTurno).success).toBe(true);
    const conTelefono = {
      ...conTurno,
      turno: {
        ...conTurno.turno,
        paciente: { ...conTurno.turno.paciente, telefono: "+59899123456" },
      },
    };
    expect(sesionClinicaResponseSchema.safeParse(conTelefono).success).toBe(true);
  });

  it("rechaza fechas que no son ISO", () => {
    const malo = { ...base, createdAt: "20/04/2026" };
    expect(sesionClinicaResponseSchema.safeParse(malo).success).toBe(false);
  });

  it("rechaza un estado desconocido", () => {
    const malo = { ...base, estado: "corrupto" };
    expect(sesionClinicaResponseSchema.safeParse(malo).success).toBe(false);
  });
});

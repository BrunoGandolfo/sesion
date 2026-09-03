import { describe, it, expect } from "vitest";

import {
  SESION_SELECT,
  toSesionClinicaResponse,
  type FilaSesionClinica,
} from "@/app/api/_lib/sesion-clinica";

const CLAVE = { claveCifrado: "clave-secreta-base64", ivCifrado: "iv-base64" };

function filaBase(): FilaSesionClinica {
  return {
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
    notaSoapOriginal: { subjetivo: "s0", objetivo: "o0", analisis: null, plan: "p0" },
    datosEstructurados: {
      temas: ["ansiedad"],
      _audioCifradoTemporal: CLAVE,
    },
    modeloASR: "asr",
    modeloLLM: "llm",
    promptVersion: "v2.1",
    hablanteTerapeuta: "S0",
    procesadoEn: new Date("2026-04-20T12:00:00.000Z"),
    aprobadoEn: null,
    error: null,
    intentos: 1,
    createdAt: new Date("2026-04-20T11:00:00.000Z"),
    updatedAt: new Date("2026-04-20T12:00:00.000Z"),
    turno: {
      id: "tur1",
      fecha: new Date("2026-04-20T10:00:00.000Z"),
      paciente: { id: "p1", nombre: "Ana", apellido: "Pérez", telefono: "+59899123456" },
    },
  };
}

describe("SESION_SELECT", () => {
  it("nunca incluye la transcripción", () => {
    expect(SESION_SELECT).not.toHaveProperty("transcripcion");
    expect(SESION_SELECT).not.toHaveProperty("transcripcionEncrypted");
  });

  it("incluye los campos que hoy piden las cuatro rutas", () => {
    for (const campo of [
      "notaSoapOriginal",
      "promptVersion",
      "hablanteTerapeuta",
      "audioBorradoEn",
      "createdAt",
      "updatedAt",
      "turno",
    ]) {
      expect(SESION_SELECT).toHaveProperty(campo);
    }
  });
});

describe("toSesionClinicaResponse", () => {
  it("nunca incluye la clave temporal en la salida serializada", () => {
    const salida = toSesionClinicaResponse(filaBase());
    const json = JSON.stringify(salida);
    expect(json).not.toContain("_audioCifradoTemporal");
    expect(json).not.toContain(CLAVE.claveCifrado);
    expect(json).not.toContain(CLAVE.ivCifrado);
    expect(salida.datosEstructurados).toEqual({ temas: ["ansiedad"] });
  });

  it("tampoco la incluye cuando datosEstructurados viene como string JSON", () => {
    const fila = filaBase();
    fila.datosEstructurados = JSON.stringify({
      temas: ["x"],
      _audioCifradoTemporal: CLAVE,
    });
    const salida = toSesionClinicaResponse(fila);
    expect(JSON.stringify(salida)).not.toContain("_audioCifradoTemporal");
    expect(salida.datosEstructurados).toEqual({ temas: ["x"] });
  });

  it("las fechas salen como string ISO", () => {
    const salida = toSesionClinicaResponse(filaBase());
    expect(salida.createdAt).toBe("2026-04-20T11:00:00.000Z");
    expect(salida.updatedAt).toBe("2026-04-20T12:00:00.000Z");
    expect(salida.procesadoEn).toBe("2026-04-20T12:00:00.000Z");
    expect(salida.aprobadoEn).toBeNull();
    expect(salida.audioBorradoEn).toBeNull();
    expect(salida.turno?.fecha).toBe("2026-04-20T10:00:00.000Z");
  });

  it("parsea datosEstructurados cuando viene como string", () => {
    const fila = filaBase();
    fila.datosEstructurados = JSON.stringify({
      temas: ["trabajo"],
      intensidadEmocional: 6,
    });
    const salida = toSesionClinicaResponse(fila);
    expect(salida.datosEstructurados).toEqual({
      temas: ["trabajo"],
      intensidadEmocional: 6,
    });
  });

  it("datosEstructurados inválido o ausente se devuelve como null", () => {
    const sinDatos = filaBase();
    sinDatos.datosEstructurados = null;
    expect(toSesionClinicaResponse(sinDatos).datosEstructurados).toBeNull();

    const corrupto = filaBase();
    corrupto.datosEstructurados = "{ no es json";
    expect(toSesionClinicaResponse(corrupto).datosEstructurados).toBeNull();
  });

  it("conserva notaSoapOriginal con secciones nullable", () => {
    const salida = toSesionClinicaResponse(filaBase());
    expect(salida.notaSoapOriginal).toEqual({
      subjetivo: "s0",
      objetivo: "o0",
      analisis: null,
      plan: "p0",
    });
  });

  it("notaSoapOriginal ausente o con forma inesperada sale null", () => {
    const sinOriginal = filaBase();
    delete sinOriginal.notaSoapOriginal;
    expect(toSesionClinicaResponse(sinOriginal).notaSoapOriginal).toBeNull();

    const raro = filaBase();
    raro.notaSoapOriginal = "texto suelto";
    expect(toSesionClinicaResponse(raro).notaSoapOriginal).toBeNull();
  });

  it("omite turno cuando la fila no lo trae (selects sin relación)", () => {
    const fila = filaBase();
    delete fila.turno;
    const salida = toSesionClinicaResponse(fila);
    expect(salida).not.toHaveProperty("turno");
  });

  it("omite telefono del paciente cuando el select no lo trae", () => {
    const fila = filaBase();
    fila.turno = {
      id: "tur1",
      fecha: new Date("2026-04-20T10:00:00.000Z"),
      paciente: { id: "p1", nombre: "Ana", apellido: "Pérez" },
    };
    const salida = toSesionClinicaResponse(fila);
    expect(salida.turno?.paciente).toEqual({ id: "p1", nombre: "Ana", apellido: "Pérez" });
  });

  it("lanza si la fila no cumple el contrato (estado desconocido)", () => {
    const fila = filaBase();
    fila.estado = "corrupto";
    expect(() => toSesionClinicaResponse(fila)).toThrow();
  });
});

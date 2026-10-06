// Las derivaciones puras de la pantalla de una sesión (datos.ts): qué nota
// se muestra, cuándo un borrador sigue siendo de la misma fila, por qué
// Aprobar no se habilita y qué cara elige la URL.
import { describe, expect, it } from "vitest";

import {
  FALTA_REVISAR_AMBAS,
  FALTA_REVISAR_MENCIONES,
  FALTA_REVISAR_RIESGO,
  FALTA_REVISAR_VERSION,
} from "@/lib/glosario";
import { CLAVE_MENCIONES } from "@/lib/sesion-clinica/aprobacion";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { mismaNota, motivoBloqueo, notaDeSesion, versionDe, vistaDeSegmento } from "../datos";

const IA = { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" };

function fila(parcial: Partial<SesionClinicaResponse>): SesionClinicaResponse {
  return { id: "ses_1", generacion: 1, estado: "revision", notaIa: IA, notaFinal: null, ...parcial } as SesionClinicaResponse;
}

describe("notaDeSesion", () => {
  it("la aprobada manda sobre la de la IA", () => {
    const final = { ...IA, plan: "corregido" };
    expect(notaDeSesion(fila({ notaFinal: final }))).toEqual(final);
    expect(notaDeSesion(fila({}))).toEqual(IA);
  });

  it("sin nota, cuatro secciones vacías", () => {
    expect(notaDeSesion(fila({ notaIa: null }))).toEqual({ subjetivo: "", objetivo: "", analisis: "", plan: "" });
  });
});

describe("mismaNota y versionDe", () => {
  it("compara las cuatro secciones", () => {
    expect(mismaNota(IA, { ...IA })).toBe(true);
    expect(mismaNota(IA, { ...IA, objetivo: "otro" })).toBe(false);
  });

  it("la versión cambia con la generación o el estado de la fila", () => {
    const base = versionDe(fila({}));
    expect(versionDe(fila({}))).toBe(base);
    expect(versionDe(fila({ generacion: 2 }))).not.toBe(base);
    expect(versionDe(fila({ estado: "aprobada" }))).not.toBe(base);
  });
});

describe("motivoBloqueo", () => {
  const nada = new Set<string>();

  it("sin casillas exigidas ni conflicto, nada lo bloquea", () => {
    expect(motivoBloqueo({ conflicto: false, claves: [], revisadas: nada })).toBeNull();
  });

  it("el conflicto de versión va primero", () => {
    expect(motivoBloqueo({ conflicto: true, claves: [], revisadas: nada })).toBe(FALTA_REVISAR_VERSION);
  });

  it("distingue señales, menciones y las dos", () => {
    const claves = ["autolesion", CLAVE_MENCIONES];
    expect(motivoBloqueo({ conflicto: false, claves, revisadas: nada })).toBe(FALTA_REVISAR_AMBAS);
    expect(motivoBloqueo({ conflicto: false, claves, revisadas: new Set(["autolesion"]) })).toBe(FALTA_REVISAR_MENCIONES);
    expect(motivoBloqueo({ conflicto: false, claves, revisadas: new Set([CLAVE_MENCIONES]) })).toBe(FALTA_REVISAR_RIESGO);
    expect(motivoBloqueo({ conflicto: false, claves, revisadas: new Set(claves) })).toBeNull();
  });
});

describe("vistaDeSegmento", () => {
  it("sin segmento es la nota; las otras dos por su nombre", () => {
    expect(vistaDeSegmento(null)).toBe("nota");
    expect(vistaDeSegmento("para-vos")).toBe("para-vos");
    expect(vistaDeSegmento("transcripcion")).toBe("transcripcion");
    expect(vistaDeSegmento("__PAGE__")).toBe("nota");
  });
});

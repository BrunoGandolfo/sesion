// La señal de riesgo que Hoy recibe de cada sesión del día (aSenalDeRiesgo,
// casos-uso/obtener-dashboard.ts): leída como la leen aprobar y el brief, y
// sin nada de material clínico.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { aSenalDeRiesgo } from "@/app/api/_lib/casos-uso/obtener-dashboard";

const FLAGS = {
  ideacionSuicida: true,
  autolesion: false,
  violenciaTerceros: false,
  sintomasPsicoticos: false,
  crisisPanico: false,
  detalle: "texto clínico que no puede salir",
};

const riesgo = (nivel: unknown) => ({
  nivel,
  indicadores: ["texto clínico"],
  evidencia: [{ timestamp: "00:01", quote: "texto" }],
  notaParaTerapeuta: "nota clínica",
});

describe("aSenalDeRiesgo", () => {
  it("un nivel válido llega, sin indicadores, evidencia, nota ni detalle de flags", () => {
    expect(aSenalDeRiesgo({ riesgoDetectado: riesgo("alto"), flagsRiesgo: FLAGS })).toEqual({
      riesgoDetectado: { nivel: "alto", indicadores: [], evidencia: [], notaParaTerapeuta: null },
      flagsRiesgo: { ...FLAGS, detalle: "" },
    });
  });

  it("un nivel inválido guardado no llega tal cual: se descarta como en aprobar", () => {
    const senal = aSenalDeRiesgo({ riesgoDetectado: riesgo("altisimo") });
    expect(senal.riesgoDetectado).toBeNull();
    expect(JSON.stringify(senal)).not.toContain("altisimo");
  });

  it("acepta el JSON como string, como lo guarda el cifrado", () => {
    expect(aSenalDeRiesgo(JSON.stringify({ riesgoDetectado: riesgo("moderado") })).riesgoDetectado?.nivel).toBe("moderado");
  });

  it("sin datos, o sin las dos claves, no hay señal", () => {
    for (const datos of [null, undefined, {}, "no es json", { temas: ["x"] }]) {
      expect(aSenalDeRiesgo(datos)).toEqual({ riesgoDetectado: null, flagsRiesgo: null });
    }
  });
});

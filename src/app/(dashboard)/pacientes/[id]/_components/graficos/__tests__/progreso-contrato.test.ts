// Lo que se deriva del contrato de /progreso sin dibujar nada.
import { describe, expect, it } from "vitest";

import {
  detalleDePunto,
  esRango,
  nivelDeAlianza,
  segmentosDe,
  tieneSenal,
  type PuntoLinea,
  type SesionProgreso,
} from "../progreso-contrato";

const punto = (valor: number | null): PuntoLinea => ({ fecha: new Date("2026-03-04T15:00:00Z"), valor });

describe("segmentosDe", () => {
  it("corta la línea en cada sesión sin dato: no interpola", () => {
    expect(segmentosDe([punto(1), punto(2), punto(null), punto(3), punto(null)])).toEqual([[0, 1], [3]]);
  });
  it("sin datos no hay tramos", () => {
    expect(segmentosDe([punto(null)])).toEqual([]);
  });
});

describe("tieneSenal", () => {
  const sesion = (parcial: Partial<SesionProgreso>) =>
    ({ nivelRiesgo: null, flagsRiesgo: {}, ...parcial }) as SesionProgreso;
  it("cuenta el nivel graduado y los flags, por separado", () => {
    expect(tieneSenal(sesion({ nivelRiesgo: "ninguno" }))).toBe(false);
    expect(tieneSenal(sesion({ nivelRiesgo: "moderado" as SesionProgreso["nivelRiesgo"] }))).toBe(true);
    expect(tieneSenal(sesion({ flagsRiesgo: { ideacion: true } }))).toBe(true);
    expect(tieneSenal(sesion({ flagsRiesgo: { ideacion: false } }))).toBe(false);
  });
});

it("la alianza tiene orden 1..4 y sin dato es null", () => {
  expect(nivelDeAlianza("fragil")).toBe(1);
  expect(nivelDeAlianza("fuerte")).toBe(4);
  expect(nivelDeAlianza(null)).toBeNull();
});

it("esRango acepta solo los cuatro rangos", () => {
  expect(["10s", "3m", "6m", "todo"].every((r) => esRango(r))).toBe(true);
  expect(esRango("1a")).toBe(false);
  expect(esRango(null)).toBe(false);
});

it("el detalle de un punto sin valor lo dice", () => {
  expect(detalleDePunto(new Date("2026-03-04T15:00:00Z"), "7 de 10")).toMatch(/· 7 de 10$/);
  expect(detalleDePunto(new Date("2026-03-04T15:00:00Z"), null)).not.toMatch(/null/);
});

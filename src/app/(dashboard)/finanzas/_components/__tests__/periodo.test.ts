import { describe, expect, it } from "vitest";

import {
  aniosElegibles,
  mesDeHoy,
  nombrePeriodo,
  nombreRango,
  queryDe,
  rotuloBarra,
} from "../periodo";

describe("queryDe: el chip se traduce a desde / hasta", () => {
  it("12 meses no manda nada: es el default del servidor", () => {
    expect(queryDe({ tipo: "doce" }, "2026-09", "2025-09")).toBe("");
  });

  it("este mes pide el mes de hoy", () => {
    expect(queryDe({ tipo: "mes" }, "2026-09", "2025-09")).toBe("?desde=2026-09&hasta=2026-09");
  });

  it("el año en curso va de enero al mes de hoy; uno pasado, entero", () => {
    expect(queryDe({ tipo: "anio", anio: 2026 }, "2026-09", null)).toBe("?desde=2026-01&hasta=2026-09");
    expect(queryDe({ tipo: "anio", anio: 2025 }, "2026-09", null)).toBe("?desde=2025-01&hasta=2025-12");
  });

  it("todo va desde el primer mes con datos y pide una barra por año", () => {
    expect(queryDe({ tipo: "todo" }, "2026-09", "2019-03")).toBe(
      "?desde=2019-03&hasta=2026-09&granularidad=anio",
    );
  });
});

it("todo no empieza después de hoy aunque el único turno sea futuro", () => {
  expect(queryDe({ tipo: "todo" }, "2026-09", "2026-11")).toBe(
    "?desde=2026-09&hasta=2026-09&granularidad=anio",
  );
});

describe("los años que se pueden elegir", () => {
  it("van del primero con datos al de hoy", () => {
    expect(aniosElegibles("2026-09", "2023-05")).toEqual({ min: 2023, max: 2026 });
  });
  it("sin datos, sólo el de hoy", () => {
    expect(aniosElegibles("2026-09", null)).toEqual({ min: 2026, max: 2026 });
  });
});

describe("rótulos", () => {
  it("dice el mes con nombre y el año solo", () => {
    expect(nombrePeriodo("2026-08")).toBe("agosto 2026");
    expect(nombrePeriodo("2026")).toBe("2026");
    expect(rotuloBarra("2026-01")).toBe("ene");
    expect(rotuloBarra("2025")).toBe("2025");
  });

  it("dice un rango corto, con el año una vez si no cambia", () => {
    expect(nombreRango("2026-06", "2026-07")).toBe("jun–jul 2026");
    expect(nombreRango("2025-12", "2026-01")).toBe("dic 2025–ene 2026");
    expect(nombreRango("2026-08", "2026-08")).toBe("agosto 2026");
  });

  it("el mes de hoy es el de Montevideo, no el de UTC", () => {
    // 1 de octubre a las 01:00 UTC es 30 de septiembre a las 22:00 en Montevideo.
    expect(mesDeHoy(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09");
  });
});

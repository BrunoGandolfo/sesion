// Cómo se muestra el tiempo y cómo viajan las pausas. Cuánto se grabó lo
// prueba grabacion-captura.test.ts: ya no se cuenta con el reloj de pared.

import { describe, expect, it } from "vitest";

import {
  aRegistradas,
  formatearDuracion,
} from "@/lib/grabacion-cronometro";


describe("formatearDuracion", () => {
  it("una medida con decimales (los chunks no llegan en segundos exactos) se muestra entera", () => {
    expect(formatearDuracion(452.7)).toBe("07:32");
  });

  it("siempre con dos dígitos", () => {
    expect(formatearDuracion(0)).toBe("00:00");
    expect(formatearDuracion(9)).toBe("00:09");
    expect(formatearDuracion(60)).toBe("01:00");
    expect(formatearDuracion(452)).toBe("07:32");
  });

  it("pasada la hora sigue contando minutos, no las corta", () => {
    // Una sesión de 90 minutos tiene que verse "90:00", no "30:00".
    expect(formatearDuracion(5400)).toBe("90:00");
  });
});

describe("aRegistradas", () => {
  it("pasa las pausas cerradas a ISO", () => {
    expect(
      aRegistradas([
        { inicio: Date.UTC(2026, 8, 5, 15, 10), fin: Date.UTC(2026, 8, 5, 15, 12) },
      ]),
    ).toEqual([
      { inicio: "2026-09-05T15:10:00.000Z", fin: "2026-09-05T15:12:00.000Z" },
    ]);
  });

  it("descarta la pausa abierta: no describe ningún tramo", () => {
    // Es la que está corriendo. Mandarla al backend haría que el schema la
    // rechace, y guardarla con `fin` inventado sería mentir sobre la duración.
    expect(
      aRegistradas([
        { inicio: Date.UTC(2026, 8, 5, 15, 10), fin: Date.UTC(2026, 8, 5, 15, 12) },
        { inicio: Date.UTC(2026, 8, 5, 15, 20), fin: null },
      ]),
    ).toHaveLength(1);
  });

  it("sin pausas devuelve una lista vacía, no null", () => {
    expect(aRegistradas([])).toEqual([]);
  });
});

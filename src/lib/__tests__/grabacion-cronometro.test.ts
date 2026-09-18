// El cronómetro de la grabación: cuánto se grabó de verdad, y cómo se ve.
//
// Los casos de `segundosGrabados` venían de grabacion-storage.test.ts y se
// mudaron acá con el módulo (src/lib/grabacion-cronometro.ts). No cambió ni
// una expectativa: es la misma aritmética, importada de su casa nueva.
//
// Instantes explícitos en epoch, no `new Date(...)` con componentes locales:
// la cuenta es en milisegundos y no tiene por qué depender de la zona del
// proceso.

import { describe, expect, it } from "vitest";

import {
  aRegistradas,
  formatearDuracion,
  segundosGrabados,
} from "@/lib/grabacion-cronometro";

const T0 = 1_700_000_000_000;

describe("segundosGrabados", () => {
  it("sin pausas cuenta todo el tiempo transcurrido", () => {
    expect(segundosGrabados(T0, T0 + 90_000)).toBe(90);
  });

  it("descuenta una pausa cerrada", () => {
    expect(
      segundosGrabados(T0, T0 + 90_000, [
        { inicio: T0 + 10_000, fin: T0 + 40_000 },
      ]),
    ).toBe(60);
  });

  it("descuenta varias pausas", () => {
    expect(
      segundosGrabados(T0, T0 + 100_000, [
        { inicio: T0 + 10_000, fin: T0 + 20_000 },
        { inicio: T0 + 50_000, fin: T0 + 65_000 },
      ]),
    ).toBe(75);
  });

  it("con una pausa abierta el cronómetro se detiene", () => {
    const pausas = [{ inicio: T0 + 30_000, fin: null }];

    expect(segundosGrabados(T0, T0 + 30_000, pausas)).toBe(30);
    expect(segundosGrabados(T0, T0 + 120_000, pausas)).toBe(30);
    expect(segundosGrabados(T0, T0 + 600_000, pausas)).toBe(30);
  });

  it("al reanudar vuelve a correr desde lo acumulado", () => {
    const pausada = [{ inicio: T0 + 30_000, fin: null }];
    expect(segundosGrabados(T0, T0 + 120_000, pausada)).toBe(30);

    const reanudada = [{ inicio: T0 + 30_000, fin: T0 + 120_000 }];
    expect(segundosGrabados(T0, T0 + 135_000, reanudada)).toBe(45);
  });

  it("recorta los tramos de pausa que caen fuera de la ventana", () => {
    expect(
      segundosGrabados(T0, T0 + 60_000, [
        { inicio: T0 - 20_000, fin: T0 + 10_000 },
        { inicio: T0 + 50_000, fin: T0 + 90_000 },
      ]),
    ).toBe(40);
  });

  it("suma lo que ya venía grabado de una recuperación", () => {
    expect(segundosGrabados(null, T0, [], 42)).toBe(42);
    expect(
      segundosGrabados(T0, T0 + 30_000, [{ inicio: T0, fin: T0 + 10_000 }], 42),
    ).toBe(62);
  });

  it("nunca devuelve un negativo", () => {
    expect(segundosGrabados(T0, T0 - 5_000)).toBe(0);
    expect(
      segundosGrabados(T0, T0 + 10_000, [{ inicio: T0, fin: T0 + 60_000 }]),
    ).toBe(0);
  });
});

describe("formatearDuracion", () => {
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

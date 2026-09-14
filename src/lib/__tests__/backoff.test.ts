// Unitario — backoff creciente, sin tope, hasta la ventana útil.

import { describe, expect, it } from "vitest";

import {
  decidirTrasFalloTransitorio,
  ESPERA_MAXIMA_MS,
  esperaMs,
  limiteUtilDelTurno,
  MOTIVO_TURNO_PASADO,
  MOTIVO_VENTANA_AGOTADA,
  VENTANA_MINIMA_MS,
} from "@/lib/sms/backoff";

const MIN = 60_000;
const AHORA = new Date("2026-09-11T20:00:00.000Z");
const SIN_JITTER = 0.5; // (0.5·2−1)·25 % = 0

describe("esperaMs", () => {
  it("tabla: 2, 4, 8, 16, 30, 30 minutos (sin jitter)", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => esperaMs(n, SIN_JITTER) / MIN)).toEqual([2, 4, 8, 16, 30, 30, 30]);
    expect(ESPERA_MAXIMA_MS).toBe(30 * MIN);
  });

  it("el jitter mueve ±25 %", () => {
    expect(esperaMs(1, 0)).toBe(1.5 * MIN);
    expect(esperaMs(1, 0.999999)).toBeCloseTo(2.5 * MIN, -3);
  });

  it("intentos < 1 se tratan como 1", () => {
    expect(esperaMs(0, SIN_JITTER)).toBe(2 * MIN);
  });
});

describe("decidirTrasFalloTransitorio", () => {
  const turno = new Date(AHORA.getTime() + 10 * 60 * MIN); // en 10 h
  const limite = limiteUtilDelTurno(turno);

  it("la ventana útil es 2 h antes del turno", () => {
    expect(VENTANA_MINIMA_MS).toBe(2 * 60 * MIN);
    expect(limite.getTime()).toBe(turno.getTime() - 2 * 60 * MIN);
  });

  it("con tiempo de sobra reintenta con la espera de la tabla, sin tope de intentos", () => {
    for (const intentos of [1, 2, 3, 7, 50]) {
      const d = decidirTrasFalloTransitorio({ intentos, ahora: AHORA, limiteUtil: limite, fechaTurno: turno, aleatorio: SIN_JITTER });
      expect(d.accion).toBe("reintentar");
      if (d.accion === "reintentar") {
        expect(d.proximoIntentoEn.getTime()).toBe(AHORA.getTime() + esperaMs(intentos, SIN_JITTER));
      }
    }
  });

  it("si la espera pasaría el límite, un último intento justo en el límite", () => {
    const ahora = new Date(limite.getTime() - 10 * MIN); // faltan 10 min para el límite; la espera sería 30
    const d = decidirTrasFalloTransitorio({ intentos: 6, ahora, limiteUtil: limite, fechaTurno: turno, aleatorio: SIN_JITTER });
    expect(d).toEqual({ accion: "reintentar", proximoIntentoEn: limite });
  });

  it("llegado el límite (dentro de las 2 h finales), fallido con el motivo", () => {
    const ahora = new Date(limite.getTime() + 1);
    expect(decidirTrasFalloTransitorio({ intentos: 3, ahora, limiteUtil: limite, fechaTurno: turno })).toEqual({
      accion: "fallido",
      motivo: MOTIVO_VENTANA_AGOTADA,
    });
    expect(decidirTrasFalloTransitorio({ intentos: 3, ahora: limite, limiteUtil: limite, fechaTurno: turno }).accion).toBe("fallido");
  });

  it("si el turno ya pasó, cancelado, nunca fallido", () => {
    const ahora = new Date(turno.getTime() + 1);
    expect(decidirTrasFalloTransitorio({ intentos: 1, ahora, limiteUtil: limite, fechaTurno: turno })).toEqual({
      accion: "cancelado",
      motivo: MOTIVO_TURNO_PASADO,
    });
  });

  it("sin turno (cobro) sólo cuenta el límite", () => {
    const limiteCobro = new Date(AHORA.getTime() + 60 * MIN);
    expect(decidirTrasFalloTransitorio({ intentos: 1, ahora: AHORA, limiteUtil: limiteCobro, aleatorio: SIN_JITTER }).accion).toBe("reintentar");
    expect(decidirTrasFalloTransitorio({ intentos: 1, ahora: limiteCobro, limiteUtil: limiteCobro }).accion).toBe("fallido");
  });

  it("con 429 el jitter es mayor", () => {
    const normal = decidirTrasFalloTransitorio({ intentos: 1, ahora: AHORA, limiteUtil: limite, aleatorio: 0 });
    const mayor = decidirTrasFalloTransitorio({ intentos: 1, ahora: AHORA, limiteUtil: limite, aleatorio: 0, jitterMayor: true });
    if (normal.accion === "reintentar" && mayor.accion === "reintentar") {
      expect(mayor.proximoIntentoEn.getTime()).toBeLessThan(normal.proximoIntentoEn.getTime());
    } else {
      throw new Error("las dos tenían que reintentar");
    }
  });
});

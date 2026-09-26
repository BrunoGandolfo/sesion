/**
 * `sePuedeCobrar` y `sePuedeGrabar` (domain.ts): las reglas del turno que
 * aplica el servidor y con las que las pantallas deciden qué ofrecer.
 *
 * Todos los instantes van en UTC explícito, armados desde el reloj de pared
 * de Montevideo (UTC-3): la regla de grabar decide con el día de MONTEVIDEO,
 * y el caso que importa es el de cerca de medianoche, cuando el día UTC ya
 * cambió y el de Montevideo no (o al revés).
 */
import { describe, expect, it } from "vitest";

import { sePuedeCobrar, sePuedeGrabar } from "@/app/api/_lib/domain";
import type { TurnoEstado, PagoEstado } from "@/types/domain";

/** Reloj de pared de Montevideo → instante. */
function mvd(dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(2026, 8, dia, hora + 3, minuto, 0, 0));
}

function turno(estado: TurnoEstado, fecha: Date, pagoEstado: PagoEstado = "pendiente") {
  return { estado, pagoEstado, fecha };
}

describe("sePuedeCobrar", () => {
  const ahora = mvd(23, 15, 20);

  it("no: programado cuya hora todavía no llegó", () => {
    expect(sePuedeCobrar(turno("programado", mvd(23, 16)), ahora)).toBe(false);
  });

  it("sí: programado con la hora ya pasada, y justo a la hora", () => {
    expect(sePuedeCobrar(turno("programado", mvd(23, 15)), ahora)).toBe(true);
    expect(sePuedeCobrar(turno("programado", ahora), ahora)).toBe(true);
  });

  it("sí: realizado sin cobrar, sea cual sea la hora", () => {
    expect(sePuedeCobrar(turno("realizado", mvd(20, 10)), ahora)).toBe(true);
    expect(sePuedeCobrar(turno("realizado", mvd(23, 18)), ahora)).toBe(true);
  });

  it.each<TurnoEstado>(["cancelado", "ausente"])("no: %s, aunque la hora haya pasado", (estado) => {
    expect(sePuedeCobrar(turno(estado, mvd(23, 10)), ahora)).toBe(false);
  });

  it.each<TurnoEstado>(["realizado", "programado"])("no: %s ya pagado", (estado) => {
    expect(sePuedeCobrar(turno(estado, mvd(23, 10), "pagado"), ahora)).toBe(false);
  });
});

describe("sePuedeGrabar, en días de Montevideo", () => {
  it("sí: un turno de hoy, antes y después de su hora", () => {
    expect(sePuedeGrabar(turno("programado", mvd(23, 16)), mvd(23, 9))).toBe(true);
    expect(sePuedeGrabar(turno("realizado", mvd(23, 9)), mvd(23, 20))).toBe(true);
  });

  it("no: un turno de ayer ni uno de mañana", () => {
    expect(sePuedeGrabar(turno("programado", mvd(22, 15)), mvd(23, 10))).toBe(false);
    expect(sePuedeGrabar(turno("programado", mvd(24, 15)), mvd(23, 10))).toBe(false);
  });

  it("cerca de medianoche manda el día de Montevideo, no el de UTC", () => {
    // 23:30 de Montevideo del 23 son las 02:30Z del 24: mismo día para
    // Montevideo que las 21:00 (00:00Z del 24) y que las 23:59.
    const turnoTarde = turno("programado", mvd(23, 23, 30));
    expect(sePuedeGrabar(turnoTarde, mvd(23, 21))).toBe(true);
    expect(sePuedeGrabar(turnoTarde, mvd(23, 23, 59))).toBe(true);
    // Diez minutos después de la medianoche de Montevideo ya es ayer.
    expect(sePuedeGrabar(turnoTarde, mvd(24, 0, 10))).toBe(false);
    // Y un turno de las 00:10 del 24 es de mañana a las 23:55 del 23, aunque
    // en UTC los dos caigan el 24.
    expect(sePuedeGrabar(turno("programado", mvd(24, 0, 10)), mvd(23, 23, 55))).toBe(false);
  });

  it.each<TurnoEstado>(["cancelado", "ausente"])("no: %s, aunque sea de hoy", (estado) => {
    expect(sePuedeGrabar(turno(estado, mvd(23, 15)), mvd(23, 14))).toBe(false);
  });
});

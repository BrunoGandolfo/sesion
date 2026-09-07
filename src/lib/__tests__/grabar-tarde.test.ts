/**
 * `puedeGrabarseHoy` — cuándo la fila de sesión ofrece grabar.
 *
 * La fila escondía "Grabar sesión" apenas pasaba la hora del turno, mientras
 * la API y el FAB de la ficha la dejaban grabar igual: una sesión que empezó
 * diez minutos tarde se quedaba sin el botón desde el que se graba en el día
 * a día. El límite real es el día, no la hora.
 *
 * Todos los instantes van en UTC explícito: el predicado decide con el día de
 * MONTEVIDEO, y escribirlos con `new Date(2026, 8, 5)` haría que el test
 * dijera cosas distintas acá y en CI.
 *
 * Referencia: 00:00 de Montevideo = 03:00Z del mismo día.
 */
import { describe, expect, it } from "vitest";

import { puedeGrabarseHoy } from "@/components/ui/session-row";
import type { TurnoEstado } from "@/types/domain";

/** Reloj de pared de Montevideo → instante. */
function mvd(mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(2026, mes - 1, dia, hora + 3, minuto, 0, 0));
}

function turno(estado: TurnoEstado, fecha: Date) {
  return { estado, fecha };
}

describe("puedeGrabarseHoy", () => {
  it("sí: el turno es de hoy y todavía no llegó su hora", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 5, 16)), mvd(9, 5, 15)),
    ).toBe(true);
  });

  it("sí: la hora ya pasó pero el turno es de hoy — el caso que se rompía", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 5, 15)), mvd(9, 5, 15, 40)),
    ).toBe(true);
  });

  it("sí: el turno ya está realizado y es de hoy", () => {
    expect(
      puedeGrabarseHoy(turno("realizado", mvd(9, 5, 15)), mvd(9, 5, 18)),
    ).toBe(true);
  });

  it("no: el turno es de ayer", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 4, 15)), mvd(9, 5, 10)),
    ).toBe(false);
  });

  it("no: el turno es de mañana", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 6, 15)), mvd(9, 5, 10)),
    ).toBe(false);
  });

  it("no: cancelado o ausente, aunque sea de hoy", () => {
    expect(
      puedeGrabarseHoy(turno("cancelado", mvd(9, 5, 15)), mvd(9, 5, 14)),
    ).toBe(false);
    expect(
      puedeGrabarseHoy(turno("ausente", mvd(9, 5, 15)), mvd(9, 5, 14)),
    ).toBe(false);
  });

  it("el día es el de Montevideo: la sesión de las 21:30 es de hoy", () => {
    // 21:30 del 5 = 00:30Z del 6. Con el día en UTC, este turno sería de
    // mañana y la fila no ofrecería grabarlo.
    const sesion = mvd(9, 5, 21, 30);
    expect(sesion.toISOString()).toBe("2026-09-06T00:30:00.000Z");
    expect(puedeGrabarseHoy(turno("programado", sesion), mvd(9, 5, 21))).toBe(true);
  });

  it("a las 23:59 de Montevideo sigue siendo el mismo día", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 5, 9)), mvd(9, 5, 23, 59)),
    ).toBe(true);
  });

  it("un minuto después, ya no", () => {
    expect(
      puedeGrabarseHoy(turno("programado", mvd(9, 5, 9)), mvd(9, 6, 0, 1)),
    ).toBe(false);
  });
});

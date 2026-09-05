// Unitario — las dos decisiones puras del módulo que relaciona el estado de
// un turno con sus recordatorios. Sin base: lo que se prueba acá es la regla,
// no la escritura (esa está en turno-recordatorios.test.ts, integración).
//
// Fechas con instantes UTC explícitos: `new Date(2026, 8, 3, 12)` cambiaría
// de significado según la zona del proceso.

import { describe, expect, it } from "vitest";

import {
  correspondeRecordatorio,
  ESTADOS_TURNO_CERRADO,
  turnoSigueProgramado,
} from "@/app/api/_lib/casos-uso/recordatorios-del-turno";

const AHORA = new Date("2026-09-05T15:00:00.000Z");

describe("turnoSigueProgramado", () => {
  it("sólo 'programado' sigue esperando a alguien", () => {
    expect(turnoSigueProgramado("programado")).toBe(true);
  });

  it("ninguno de los estados cerrados espera a nadie", () => {
    for (const estado of ESTADOS_TURNO_CERRADO) {
      expect(turnoSigueProgramado(estado)).toBe(false);
    }
  });

  it("la lista de estados cerrados es la de TurnoEstado menos programado", () => {
    // Si mañana aparece un estado nuevo en src/types/domain.ts y nadie lo
    // agrega acá, este test no lo detecta —no puede, es una unión de tipos—
    // pero al menos deja escrito cuál era la lista el día que se escribió.
    expect([...ESTADOS_TURNO_CERRADO]).toEqual([
      "realizado",
      "ausente",
      "cancelado",
    ]);
  });
});

describe("correspondeRecordatorio", () => {
  it("un turno futuro lleva recordatorio", () => {
    expect(
      correspondeRecordatorio(new Date("2026-09-08T15:00:00.000Z"), AHORA),
    ).toBe(true);
  });

  it("un turno que ya pasó no lleva recordatorio", () => {
    expect(
      correspondeRecordatorio(new Date("2026-09-04T15:00:00.000Z"), AHORA),
    ).toBe(false);
  });

  it("el borde exacto (la fecha del turno es ahora) cuenta como pasado", () => {
    // Es el caso de /grabar/nuevo: el turno se crea con la hora de este
    // instante porque la sesión está empezando. Un recordatorio de algo que
    // está pasando no es un recordatorio.
    expect(correspondeRecordatorio(AHORA, AHORA)).toBe(false);
  });

  it("un milisegundo en el futuro ya cuenta como futuro", () => {
    expect(
      correspondeRecordatorio(new Date(AHORA.getTime() + 1), AHORA),
    ).toBe(true);
  });

  it("un milisegundo en el pasado ya cuenta como pasado", () => {
    expect(
      correspondeRecordatorio(new Date(AHORA.getTime() - 1), AHORA),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { mensajeTurnoAgendado, payloadNuevoTurno } from "@/lib/agendar-turno";
import { TURNO_AGENDADO } from "@/lib/glosario";

const DATOS = {
  pacienteId: "p1",
  fecha: "2026-09-10",
  hora: "12:00",
  duracion: 50 as const,
  modalidad: "presencial" as const,
  notas: "  consulta  ",
  frecuencia: "unico" as const,
};

describe("payloadNuevoTurno", () => {
  it("manda la hora del consultorio en ISO, las notas recortadas y la frecuencia", () => {
    expect(payloadNuevoTurno(DATOS)).toEqual({
      pacienteId: "p1",
      fecha: "2026-09-10T15:00:00.000Z",
      duracion: 50,
      modalidad: "presencial",
      notas: "consulta",
      frecuencia: "unico",
    });
  });

  it("notas vacías viajan como null; la serie viaja con su frecuencia", () => {
    const payload = payloadNuevoTurno({ ...DATOS, notas: "   ", frecuencia: "quincenal" });
    expect(payload.notas).toBeNull();
    expect(payload.frecuencia).toBe("quincenal");
  });
});

describe("mensajeTurnoAgendado", () => {
  it("un turno suelto dice lo de siempre", () => {
    expect(mensajeTurnoAgendado({ serie: null })).toBe(TURNO_AGENDADO);
    expect(mensajeTurnoAgendado({})).toBe(TURNO_AGENDADO);
    expect(mensajeTurnoAgendado(undefined)).toBe(TURNO_AGENDADO);
  });

  it("una serie completa dice cuántos turnos quedaron", () => {
    expect(mensajeTurnoAgendado({ serie: { creados: 13, omitidas: [] } })).toBe(
      "13 turnos agendados",
    );
  });

  it("una fecha omitida por choque se nombra, con la fecha en Montevideo", () => {
    // 2026-09-29T18:00Z es el 29 de septiembre a las 15:00 de Montevideo.
    const mensaje = mensajeTurnoAgendado({
      serie: { creados: 12, omitidas: ["2026-09-29T18:00:00.000Z"] },
    });
    expect(mensaje).toBe(
      "12 turnos agendados. No se agendó el 29 sep: ya había un turno a esa hora.",
    );
  });

  it("varias fechas omitidas se listan", () => {
    const mensaje = mensajeTurnoAgendado({
      serie: {
        creados: 11,
        omitidas: ["2026-09-29T18:00:00.000Z", new Date("2026-10-13T18:00:00.000Z")],
      },
    });
    expect(mensaje).toBe(
      "11 turnos agendados. No se agendaron 2 fechas por choque de horario: 29 sep, 13 oct.",
    );
  });
});

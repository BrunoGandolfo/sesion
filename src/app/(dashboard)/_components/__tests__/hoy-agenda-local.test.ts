// Lo que Hoy deja en el teléfono para grabar sin señal (datos.ts,
// turnosParaAgendaLocal). Debe quedar cierto que entran los turnos del día que
// se pueden grabar —programados o realizados, sin una sesión ya cerrada—, que
// el próximo turno (que puede ser de mañana) no entra, y que de cada turno
// sale sólo id, paciente, nombre y fecha.
import { describe, expect, it } from "vitest";

import type { TurnoConPaciente } from "@/types/domain";

import { turnosParaAgendaLocal } from "../datos";

function turno(id: string, estado: TurnoConPaciente["estado"], sesion: string | null = null): TurnoConPaciente {
  return {
    id,
    pacienteId: `pac_${id}`,
    fecha: new Date("2026-10-13T18:00:00.000Z"),
    duracion: 50,
    modalidad: "presencial",
    estado,
    tarifaCobrada: 2200,
    pagoEstado: "pendiente",
    pagoFecha: null,
    pagoMetodo: null,
    notas: "nota privada del turno",
    serieId: null,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    organizationId: "org",
    sesionClinica: sesion ? { id: `s_${id}`, estado: sesion } : null,
    paciente: { id: `pac_${id}`, nombre: "Ana", apellido: "Pérez", telefono: "099 000 000" },
  };
}

describe("Hoy → agenda local", () => {
  it("los turnos del día que se pueden grabar, y nada más de cada uno", () => {
    const sesionesHoy = [
      turno("a", "programado"),
      turno("b", "realizado"),
      turno("c", "programado", "grabando"),
      turno("d", "realizado", "procesando"),
      turno("e", "cancelado"),
      turno("f", "ausente"),
    ];
    const salida = turnosParaAgendaLocal({ sesionesHoy });
    expect(salida.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(salida[0]).toEqual({
      id: "a",
      pacienteId: "pac_a",
      fecha: new Date("2026-10-13T18:00:00.000Z"),
      nombreParaMostrar: "Ana Pérez",
    });
  });

  it("no mira el próximo turno: sólo recibe los del día", () => {
    // El tipo ya no acepta proximaSesion; un objeto con más campos tampoco lo usa.
    const datos = { sesionesHoy: [turno("a", "programado")], proximaSesion: turno("z", "programado") };
    expect(turnosParaAgendaLocal(datos).map((t) => t.id)).toEqual(["a"]);
  });
});

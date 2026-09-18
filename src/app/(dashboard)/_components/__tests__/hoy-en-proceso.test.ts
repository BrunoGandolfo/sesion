// Qué sesiones del día muestra Hoy como "Procesando" y pasa al aviso.

import { expect, it } from "vitest";

import type { TurnoConPaciente } from "@/types/domain";

import { sesionesEnProceso } from "../datos";

function turno(id: string, nombre: string, sesion: TurnoConPaciente["sesionClinica"]) {
  return {
    id,
    sesionClinica: sesion,
    paciente: { id: `p-${id}`, nombre, apellido: "Pérez", telefono: "099" },
  } as TurnoConPaciente;
}

it("solo las que suben o procesan, en orden, con nombre y apellido", () => {
  const turnos = [
    turno("t1", "Ana", { id: "s1", estado: "procesando" }),
    turno("t2", "Berta", { id: "s2", estado: "revision" }),
    turno("t3", "Carla", null),
    turno("t4", "Dora", { id: "s4", estado: "subiendo" }),
    turno("t5", "Eva", { id: "s5", estado: "fallida" }),
    turno("t6", "Flor", { id: "s6", estado: "grabando" }),
  ];
  expect(sesionesEnProceso(turnos)).toEqual([
    { turnoId: "t1", sesionId: "s1", paciente: "Ana Pérez" },
    { turnoId: "t4", sesionId: "s4", paciente: "Dora Pérez" },
  ]);
});

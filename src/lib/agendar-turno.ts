// Agendar un turno desde una pantalla: el body que se manda a POST /api/turnos
// y el mensaje que se muestra con la respuesta. Puro y compartido por Hoy
// (dashboard.tsx) y Agenda (agenda-view.tsx): antes cada pantalla armaba el
// body a mano, y con las series habría que haber repetido también cómo se
// cuenta cuántos turnos quedaron y cuáles chocaron.

import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import { fechaCorta } from "@/lib/format";
import { SERIE_AGENDADA, SERIE_OMITIDAS, TURNO_AGENDADO } from "@/lib/glosario";
import type { FrecuenciaTurno, TurnoCreado } from "@/types/domain";

export interface PayloadNuevoTurno {
  pacienteId: string;
  /** ISO. La hora del formulario es la del consultorio, no la del aparato. */
  fecha: string;
  duracion: number;
  modalidad: string;
  notas: string | null;
  frecuencia: FrecuenciaTurno;
}

export function payloadNuevoTurno(data: NuevoTurnoData): PayloadNuevoTurno {
  const notas = data.notas.trim();
  return {
    pacienteId: data.pacienteId,
    fecha: instanteDesdeFechaHoraMvd(data.fecha, data.hora).toISOString(),
    duracion: data.duracion,
    modalidad: data.modalidad,
    notas: notas ? notas : null,
    frecuencia: data.frecuencia,
  };
}

/** Lo que llega por la red: las fechas de la serie vienen como ISO. */
type TurnoCreadoJson = Partial<
  Omit<TurnoCreado, "serie"> & {
    serie: { creados: number; omitidas: (string | Date)[] } | null;
  }
>;

// Textos nuevos de pantalla (pendientes de glosario.ts: ver
// docs/pendientes/06-estructura.md). Se quedan acá hasta que quien integra
// el glosario los mueva.



/**
 * "Turno agendado" para un turno suelto. Para una serie, cuántos quedaron y,
 * si alguna fecha chocó con otro turno, cuáles: la profesional decide si las
 * agenda a mano en otro horario.
 */
export function mensajeTurnoAgendado(creado: TurnoCreadoJson | null | undefined): string {
  const serie = creado?.serie;
  if (!serie) return TURNO_AGENDADO;
  const partes = [SERIE_AGENDADA(serie.creados)];
  if (serie.omitidas.length > 0) {
    partes.push(SERIE_OMITIDAS(serie.omitidas.map((f) => fechaCorta(new Date(f)))));
  }
  return partes.join(". ");
}

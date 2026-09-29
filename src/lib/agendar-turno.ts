// Agendar un turno desde una pantalla: lo que el formulario necesita leer
// (pacientes y tarifa), el body que se manda a POST /api/turnos y el mensaje
// que se muestra con la respuesta. Compartido por Hoy (dashboard.tsx) y
// Agenda (agenda-view.tsx), que antes lo tenían cada una a su manera: ya
// divergían en el error, en el parseo de las pacientes y en si la lista se
// volvía a pedir después de crear una (forense 03, P3-18).

import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";
import { instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import { fechaCorta } from "@/lib/format";
import {
  NO_SE_PUDO_AGENDAR,
  SERIE_AGENDADA,
  SERIE_OMITIDAS,
  TURNO_AGENDADO,
} from "@/lib/glosario";
import { parsePaciente, type PacienteJson } from "@/lib/json-turno";
import type {
  Configuracion,
  FrecuenciaTurno,
  PacienteConDeuda,
  TurnoCreado,
} from "@/types/domain";

/**
 * Las pacientes y la tarifa de Tu consultorio, para el formulario. La tarifa
 * es best-effort: sin ella se agenda igual, solo no se puede crear una
 * paciente desde ahí. Si la lista falla, rechaza.
 */
export async function leerPacientesParaAgendar(): Promise<{
  pacientes: PacienteConDeuda[];
  tarifaDefault: number | null;
}> {
  const [lista, config] = await Promise.all([
    apiGet<PacienteJson[]>("/api/pacientes"),
    apiGet<Configuracion>("/api/config").catch(() => null),
  ]);
  return { pacientes: lista.map(parsePaciente), tarifaDefault: config?.tarifaDefault ?? null };
}

/**
 * POST /api/turnos. Si la API rechaza (un 409 por solapamiento, por
 * ejemplo), relanza su ApiClientError: el formulario muestra el motivo y se
 * queda abierto con lo escrito. Cualquier otro error sale como
 * NO_SE_PUDO_AGENDAR.
 */
export async function crearTurno(valores: NuevoTurnoData): Promise<TurnoCreado> {
  try {
    return await apiPost<TurnoCreado>("/api/turnos", payloadNuevoTurno(valores));
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(NO_SE_PUDO_AGENDAR, 0);
  }
}

interface PayloadNuevoTurno {
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

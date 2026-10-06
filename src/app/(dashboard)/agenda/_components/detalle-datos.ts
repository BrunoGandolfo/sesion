// Lecturas y reglas del detalle del turno: qué se le pide a la API (la sesión
// clínica y el recordatorio) y qué acciones se ofrecen según el estado.
//
// Vive fuera de turno-detail-sheet.tsx porque no es pantalla. Sin estado, sin
// efectos, sin React. Las reglas no se escriben acá: Cobrar es sePuedeCobrar
// y la acción clínica es accionClinicaDe, las mismas que usan el servidor,
// la fila de la agenda y la card de Ahora.

import { sePuedeCobrar } from "@/app/api/_lib/domain";
import { apiGet } from "@/lib/api-client";
import { AGENDADO, CANCELADO, NO_VINO, PAGADO, PENDIENTE } from "@/lib/glosario";
import {
  accionClinicaDe,
  type AccionClinica,
  type SesionDelTurno as SesionConQueSeDecide,
} from "@/lib/sesion-clinica/accion-clinica";
import type { TurnoConPaciente } from "@/types/domain";

/** La sesión clínica del turno tal como la devuelve la API. */
export type SesionDelTurno = { id: string; estado?: string; actualizadaEn?: string } | null;

/** El recordatorio tal como viaja por la red: las fechas son ISO. */
export type RecordatorioJson = {
  id: string;
  estado: string;
  programadoEn: string;
  aceptadoEn: string | null;
  intentos: number;
  motivoNoEnvio: string | null;
};

export function leerSesion(turnoId: string, signal?: AbortSignal): Promise<SesionDelTurno> {
  return apiGet<SesionDelTurno>(`/api/sesion-clinica?turnoId=${turnoId}`, { signal });
}

/** El recordatorio del turno, o null si no tiene ninguno. */
export async function leerRecordatorio(
  turnoId: string,
  signal?: AbortSignal,
): Promise<RecordatorioJson | null> {
  const lista = await apiGet<RecordatorioJson[]>(`/api/sms/envios?turnoId=${turnoId}`, { signal });
  return lista[0] ?? null;
}

// El mismo estado que muestra la fila de la agenda (session-row), con las
// mismas palabras: acá decía "Cobrado"/"Sin cobrar" y allá "Pagado"/
// "Pendiente". Es un turno solo y se llama de una sola manera.
export function chipDe(turno: TurnoConPaciente) {
  if (turno.estado === "cancelado")
    return { variant: "neutral" as const, label: CANCELADO };
  if (turno.estado === "ausente")
    return { variant: "neutral" as const, label: NO_VINO };
  if (turno.pagoEstado === "pagado")
    return { variant: "sage" as const, label: PAGADO };
  if (turno.estado === "realizado")
    return { variant: "terracotta" as const, label: PENDIENTE };
  return { variant: "gold" as const, label: AGENDADO };
}

export interface AccionesDelDetalle {
  /** La sesión con que se decide: la leída, o la que trae el turno de la
   *  agenda mientras la lectura no contestó. */
  sesion: SesionConQueSeDecide;
  clinica: AccionClinica;
  puedeCobrar: boolean;
  puedeDeshacerCobro: boolean;
  /** Programado o realizado: el turno muestra el brief y las acciones. */
  puedeGrabarORevisar: boolean;
  /** Reprogramar, No vino y Cancelar. */
  esProgramado: boolean;
}

/**
 * Qué ofrece el detalle. `sesion` es "sin-dato" mientras la lectura no
 * contestó: entonces vale la que trae el turno de la agenda (con null
 * ofrecía "Grabar sesión" sobre un turno ya grabado hasta que llegaba la
 * respuesta, forense 03, P3-21).
 */
export function accionesDelDetalle(
  turno: TurnoConPaciente,
  sesion: SesionDelTurno | "sin-dato",
  ahora: Date,
): AccionesDelDetalle {
  const sesionDatos = sesion !== "sin-dato" ? sesion : (turno.sesionClinica ?? null);
  const esProgramado = turno.estado === "programado";
  return {
    sesion: sesionDatos,
    // La acción clínica, la misma que la fila y la card de Ahora: una subida
    // o una grabación que quedó a medias no se está procesando, y una
    // grabación en curso se sigue grabando.
    clinica: accionClinicaDe(sesionDatos, turno, ahora),
    // No se ofrece Cobrar a un turno cuya hora no llegó.
    puedeCobrar: sePuedeCobrar(turno, ahora),
    // Se puede deshacer mientras el turno siga cobrado. Es una reversión: el
    // turno vuelve a quedar sin cobrar y se puede volver a cobrar.
    puedeDeshacerCobro: turno.pagoEstado === "pagado",
    puedeGrabarORevisar: esProgramado || turno.estado === "realizado",
    esProgramado,
  };
}

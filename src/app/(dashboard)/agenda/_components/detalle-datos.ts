// Lecturas y reglas del detalle del turno: qué se le pide a la API (la sesión
// clínica y el aviso por WhatsApp) y qué acciones se ofrecen según el estado.
//
// Vive fuera de turno-detail-sheet.tsx porque no es pantalla. Sin estado, sin
// efectos, sin React. Las reglas no se escriben acá: Cobrar es sePuedeCobrar
// y la acción clínica es accionClinicaDe, las mismas que usan el servidor,
// la fila de la agenda y la card de Ahora.

import { sePuedeCobrar, turnoSigueProgramado } from "@/app/api/_lib/domain";
import {
  cobrarCierraElTurno,
  seGrabaEnEsteEstado,
  sePuedeDeshacerCobro,
} from "@/components/turno/presentacion";
import { apiGet } from "@/lib/api-client";
import {
  accionClinicaDe,
  type AccionClinica,
  type SesionDelTurno as SesionConQueSeDecide,
} from "@/lib/sesion-clinica/accion-clinica";
import type { AvisoDelTurno, TurnoConPaciente } from "@/types/domain";

/** La sesión clínica del turno tal como la devuelve la API. */
export type SesionDelTurno = { id: string; estado?: string; actualizadaEn?: string } | null;

export function leerSesion(turnoId: string, signal?: AbortSignal): Promise<SesionDelTurno> {
  return apiGet<SesionDelTurno>(`/api/sesion-clinica?turnoId=${turnoId}`, { signal });
}

/** El aviso por WhatsApp del turno: cuándo lo avisó para su fecha vigente,
 *  o null si todavía no. */
export function leerRecordatorio(turnoId: string, signal?: AbortSignal): Promise<AvisoDelTurno> {
  return apiGet<AvisoDelTurno>(`/api/recordatorios/whatsapp/${turnoId}`, { signal });
}

export interface AccionesDelDetalle {
  /** La sesión con que se decide: la leída, o la que trae el turno de la
   *  agenda mientras la lectura no contestó. */
  sesion: SesionConQueSeDecide;
  clinica: AccionClinica;
  puedeCobrar: boolean;
  puedeDeshacerCobro: boolean;
  /** Cobrar lo deja realizado (un programado). */
  cobrarCierra: boolean;
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
  const esProgramado = turnoSigueProgramado(turno.estado);
  return {
    sesion: sesionDatos,
    // La acción clínica, la misma que la fila y la card de Ahora: una subida
    // o una grabación que quedó a medias no se está procesando, y una
    // grabación en curso se sigue grabando.
    clinica: accionClinicaDe(sesionDatos, turno, ahora),
    // No se ofrece Cobrar a un turno cuya hora no llegó.
    puedeCobrar: sePuedeCobrar(turno, ahora),
    // Se puede deshacer mientras el turno siga cobrado, en cualquier estado.
    // Es una reversión: el turno vuelve a quedar sin cobrar.
    puedeDeshacerCobro: sePuedeDeshacerCobro(turno),
    cobrarCierra: cobrarCierraElTurno(turno.estado),
    puedeGrabarORevisar: seGrabaEnEsteEstado(turno.estado),
    esProgramado,
  };
}

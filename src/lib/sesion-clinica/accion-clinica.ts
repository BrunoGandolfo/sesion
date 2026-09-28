// Qué acción clínica se le ofrece a un turno: la misma en la fila (Hoy y
// Agenda), en la card de Ahora y en el detalle del turno.
//
// Antes cada una tenía su regla y no coincidían (forense 03, P3-08): con una
// subida en curso la card decía "Procesando" y la fila, debajo, ofrecía
// "Grabar sesión"; con una nota fallida la fila ofrecía grabar de nuevo, y el
// servidor contestaba 409 porque la sesión ya existía. Ahora las tres
// pantallas llaman a esta función y sólo deciden cómo dibujar el resultado.
//
// Módulo puro: sin Prisma ni Node. Lo importa código de cliente.
//
// Lo que NO decide: la firma de la autorización (se avisa donde iría Grabar)
// ni el cobro (independiente de la acción clínica, sePuedeCobrar).

import { sePuedeGrabar } from "@/app/api/_lib/domain";

import {
  esGrabacionSinTerminar,
  estaEnProceso,
  puede,
  type EstadoSesion,
} from "./estados";

/** Lo mínimo que hace falta saber de la sesión del turno. */
export type SesionDelTurno = {
  id: string;
  /** Opcional porque algunas lecturas de la pantalla lo traen así; sin
   *  estado la sesión no ofrece nada. */
  estado?: EstadoSesion | string;
  actualizadaEn?: Date | string | null;
} | null | undefined;

export type AccionClinica =
  /** Ir a grabar. `retomar`: la grabación o la subida quedó a medias
   *  (esGrabacionSinTerminar) y la pantalla de grabar ofrece la copia
   *  guardada en el teléfono. */
  | { tipo: "grabar"; retomar: boolean }
  /** El audio se está subiendo o el worker la tiene: no hay nada que tocar. */
  | { tipo: "escribiendo" }
  /** Hay una nota (o un fallo) que abrir. */
  | { tipo: "nota"; sesionId: string; estado: "fallida" | "revision" | "aprobada" }
  /** Nada clínico que ofrecer (turno de otro día, cancelado, ausente). */
  | { tipo: "ninguna" };

/**
 * La acción clínica del turno en `ahora`.
 *
 * - Una sesión con nota o fallida lleva a la nota: fallida puede
 *   reintentarse, revision aprobarse, aprobada ya está.
 * - Una grabación o subida a medias se retoma, sea el día que sea: el
 *   servidor deja reanudar una sesión en `grabando` pasada la medianoche
 *   (casos-uso/audio.ts, prepararAudio).
 * - Subiendo (reciente) o procesando: se está escribiendo.
 * - Sin sesión, o con la grabación en curso: se graba si el turno es de hoy
 *   y está programado o realizado (sePuedeGrabar, la regla del servidor).
 */
export function accionClinicaDe(
  sesion: SesionDelTurno,
  turno: { estado: string; fecha: Date },
  ahora: Date,
): AccionClinica {
  const estado = sesion?.estado;
  if (sesion && (estado === "fallida" || estado === "revision" || estado === "aprobada")) {
    return { tipo: "nota", sesionId: sesion.id, estado };
  }
  if (esGrabacionSinTerminar(sesion, ahora)) return { tipo: "grabar", retomar: true };
  if (estaEnProceso(estado)) return { tipo: "escribiendo" };
  // Grabar es crear la sesión (sin sesión) o seguir la que está en
  // `grabando` (la única desde la que vale empezar la subida).
  const seGraba = sesion ? puede("empezar_subida", estado) : puede("crear", null);
  if (seGraba && sePuedeGrabar(turno, ahora)) return { tipo: "grabar", retomar: false };
  return { tipo: "ninguna" };
}

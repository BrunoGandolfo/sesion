// Cómo se presenta un turno: qué palabra y qué color lleva su estado, qué
// se dice de su pago y de su nota, y qué pasa con la firma que falta. Lo
// usan Hoy (fila y card de Ahora), la Agenda (fila, detalle, semana y mes) y
// la ficha (Sesiones y Turnos y pagos).
//
// Antes cada pantalla tenía su copia y no coincidían: "Agendado" era neutro
// en la fila y dorado en el detalle; la ficha escondía un cobro si el turno
// había pasado a "No vino"; la nota aprobada era "Nota lista" en Hoy y "Nota
// guardada" en la ficha (revisión C, hallazgos 2 a 7).
//
// Las reglas no se escriben acá: salen del dominio (sePuedeCobrar,
// puedeTransicionTurno, ESTADOS_GRABABLES, ESTADOS_QUE_OCUPAN) y de
// accionClinicaDe. Este módulo sólo las nombra para la pantalla. Los colores
// son los del sistema de diseño: salvia es lo que está bien (pagado, nota
// lista), terracota es plata que falta o un problema, y lo demás es neutro.
//
// Módulo puro: sin React. Lo importan componentes cliente.

import {
  ESTADOS_GRABABLES,
  puedeTransicionTurno,
  sePuedeCobrar,
} from "@/app/api/_lib/domain";
import { ESTADOS_QUE_OCUPAN } from "@/lib/constantes-turno";
import {
  AGENDADO,
  CANCELADO,
  GRABACION_SIN_TERMINAR,
  GRABANDO,
  NO_VINO,
  NOTA_FALLIDA,
  NOTA_LISTA,
  NOTA_PROCESANDO,
  PAGADO,
  PARA_REVISAR,
  PENDIENTE,
  REALIZADO,
  VER_QUE_PASO,
} from "@/lib/glosario";
import type { AccionClinica } from "@/lib/sesion-clinica/accion-clinica";

export type Tono = "sage" | "terracotta" | "neutral";

/** Un rótulo de estado: la palabra y el tono del Chip. */
export type Rotulo = { label: string; variant: Tono };

// Una palabra, un color. La tabla es la única que los junta.
const AGENDADO_R: Rotulo = { label: AGENDADO, variant: "neutral" };
const REALIZADO_R: Rotulo = { label: REALIZADO, variant: "neutral" };
const NO_VINO_R: Rotulo = { label: NO_VINO, variant: "neutral" };
const CANCELADO_R: Rotulo = { label: CANCELADO, variant: "neutral" };
const PAGADO_R: Rotulo = { label: PAGADO, variant: "sage" };
const SIN_COBRAR_R: Rotulo = { label: PENDIENTE, variant: "terracotta" };

/** El punto de un turno en el mes y en la tira de la semana: el mismo tono
 *  que su chip, con lo que ya no ocupa el horario más apagado. */
const PUNTO: Record<string, string> = {
  [AGENDADO]: "bg-ink-500",
  [PAGADO]: "bg-sage-500",
  [PENDIENTE]: "bg-terracotta-500",
  [NO_VINO]: "bg-ink-300",
  [CANCELADO]: "bg-ink-300",
};

type EstadoYPago = { estado: string; pagoEstado: string };

/**
 * El estado del turno con su pago, en un solo rótulo: la fila de Hoy y de
 * Agenda, el detalle del turno y los puntos del mes. Cancelado y "No vino"
 * mandan sobre el pago; después, cobrado; después, agendado o sin cobrar.
 */
export function estadoDelTurno(turno: EstadoYPago): Rotulo & { punto: string } {
  const rotulo =
    turno.estado === "cancelado"
      ? CANCELADO_R
      : turno.estado === "ausente"
        ? NO_VINO_R
        : turno.pagoEstado === "pagado"
          ? PAGADO_R
          : turno.estado === "programado"
            ? AGENDADO_R
            : SIN_COBRAR_R;
  return { ...rotulo, punto: PUNTO[rotulo.label]! };
}

const SIN_PAGO: Record<string, Rotulo> = {
  programado: AGENDADO_R,
  realizado: REALIZADO_R,
  ausente: NO_VINO_R,
  cancelado: CANCELADO_R,
};

/** El estado solo, sin el pago: la columna Estado de Turnos y pagos, que
 *  dice el pago en la columna de al lado. */
export function estadoSinPago(estado: string): Rotulo {
  return SIN_PAGO[estado] ?? AGENDADO_R;
}

/**
 * La columna Pago de la ficha: "Pagado" si está cobrado, en cualquier estado
 * (un turno cobrado que después pasó a "No vino" sigue cobrado); "Sin cobrar"
 * si se puede cobrar (sePuedeCobrar, la regla del servidor); si no, nada.
 */
export function pagoDelTurno(
  turno: EstadoYPago & { fecha: Date },
  ahora: Date,
): Rotulo | null {
  if (turno.pagoEstado === "pagado") return PAGADO_R;
  if (sePuedeCobrar(turno, ahora)) return SIN_COBRAR_R;
  return null;
}

/** Se puede deshacer mientras siga cobrado, sea cual sea el estado: es lo
 *  que acepta el servidor (casos-uso/cobrar-turno.ts, descobrar). */
export function sePuedeDeshacerCobro(turno: { pagoEstado: string }): boolean {
  return turno.pagoEstado === "pagado";
}

/** Cobrar este turno lo deja realizado (sólo un programado). */
export function cobrarCierraElTurno(estado: string): boolean {
  return puedeTransicionTurno("cobrarCierra", estado);
}

/** Programado, impago y con la hora ya empezada: cobrarlo lo cierra. */
export function empezoSinCobrar(
  turno: EstadoYPago & { fecha: Date },
  ahora: Date,
): boolean {
  return sePuedeCobrar(turno, ahora) && cobrarCierraElTurno(turno.estado);
}

/** Ocupa su horario en la agenda: lo que no, se dibuja apagado y se puede
 *  agendar encima. */
export function ocupaElHorario(estado: string): boolean {
  return (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado);
}

/** En este estado el turno se puede grabar (el día lo decide sePuedeGrabar). */
export function seGrabaEnEsteEstado(estado: string): boolean {
  return (ESTADOS_GRABABLES as readonly string[]).includes(estado);
}

/**
 * La nota del turno, separada del pago. Cada rótulo lleva a la sesión; el
 * de la fallida, además, se pinta como problema.
 */
export function rotuloDeNota(
  sesion: { id: string; estado?: string } | null | undefined,
): { rotulo: string; sesionId: string; fallida: boolean } | null {
  if (!sesion) return null;
  if (sesion.estado === "fallida") {
    return { rotulo: `${NOTA_FALLIDA} · ${VER_QUE_PASO}`, sesionId: sesion.id, fallida: true };
  }
  if (sesion.estado === "revision") return { rotulo: PARA_REVISAR, sesionId: sesion.id, fallida: false };
  if (sesion.estado === "aprobada") return { rotulo: NOTA_LISTA, sesionId: sesion.id, fallida: false };
  return null;
}

const PROCESO: Record<string, Rotulo> = {
  grabando: { label: GRABANDO, variant: "neutral" },
  subiendo: { label: NOTA_PROCESANDO, variant: "neutral" },
  procesando: { label: NOTA_PROCESANDO, variant: "neutral" },
  revision: { label: PARA_REVISAR, variant: "sage" },
  aprobada: { label: NOTA_LISTA, variant: "sage" },
  fallida: { label: NOTA_FALLIDA, variant: "terracotta" },
};

/**
 * El chip de la sesión en la ficha. Una grabación o subida que quedó a medias
 * (esGrabacionSinTerminar, que decide quien llama) se dice así y no con su
 * estado: la pantalla de grabar ofrece la copia guardada en el teléfono.
 */
export function rotuloDelProceso(
  estado: string,
  { sinTerminar }: { sinTerminar: boolean },
): Rotulo | null {
  if (sinTerminar) return { label: GRABACION_SIN_TERMINAR, variant: "terracotta" };
  return PROCESO[estado] ?? null;
}

/**
 * La firma de la autorización que falta. Si el turno se graba, va en lugar
 * de Grabar (la pantalla de grabar no deja sin ella); si no, se avisa igual,
 * al lado de lo que haya: la firma hace falta para la próxima.
 *
 * accionClinicaDe no la decide a propósito; ésta es la regla que comparten
 * la fila y la card de Ahora.
 */
export function firmaDelTurno(
  clinica: AccionClinica,
  sinAutorizacion: boolean,
): "en-lugar-de-grabar" | "aviso" | null {
  if (!sinAutorizacion) return null;
  return clinica.tipo === "grabar" ? "en-lugar-de-grabar" : "aviso";
}

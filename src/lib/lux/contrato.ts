// El contrato de POST /api/pacientes/[id]/lux, en un solo lugar: lo importan
// la ruta (src/app/api/pacientes/[id]/lux/route.ts), el caso de uso
// (casos-uso/lux/) y la pantalla (src/components/lux/). docs/contrato-lux.md
// lo cuenta en prosa; si los dos dicen cosas distintas, manda este archivo.
//
// Lo usan servidor y navegador: no importa nada más que zod.

import { z } from "zod";

// ─── La petición ────────────────────────────────────────────────────────────

/** Largo máximo de una pregunta (y de cada turno de ella en el historial). */
export const LARGO_MAX_PREGUNTA_LUX = 2000;

/** Largo máximo de un turno de Lux que vuelve en el historial. Una respuesta
 *  puede ser larga (varias rondas con sus citas y avisos) y tiene que poder
 *  volver entera: es un tope contra un cuerpo enorme, no contra Lux. */
export const LARGO_MAX_TURNO_LUX = 100_000;

/** Cuántos turnos de historial acepta la ruta. El caso de uso usa los
 *  últimos MAX_TURNOS_HISTORIAL (6, como Lupita). */
export const MAX_TURNOS_HISTORIAL_LUX = 12;

export const turnoHistorialLuxSchema = z.discriminatedUnion("rol", [
  z.object({ rol: z.literal("usuaria"), texto: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA_LUX) }),
  z.object({ rol: z.literal("asistente"), texto: z.string().trim().min(1).max(LARGO_MAX_TURNO_LUX) }),
]);

/** Sin `pregunta` ni `historial` (`{}`): la apertura, Lux habla primero.
 *  Con historial hace falta una pregunta. */
export const peticionLuxSchema = z.object({
  pregunta: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA_LUX).optional(),
  historial: z.array(turnoHistorialLuxSchema).max(MAX_TURNOS_HISTORIAL_LUX).optional(),
}).strict().refine(
  (cuerpo) => cuerpo.pregunta !== undefined || !cuerpo.historial?.length,
  { message: "Con historial hace falta una pregunta", path: ["pregunta"] },
);

export type TurnoHistorialLux = z.infer<typeof turnoHistorialLuxSchema>;
export type PeticionLux = z.infer<typeof peticionLuxSchema>;

/** El status con que la ruta dice que se terminó el cupo del día. */
export const STATUS_TOPE_LUX = 429;

// ─── La respuesta ───────────────────────────────────────────────────────────
//
// text/plain en streaming, con dos marcas adentro:
//
//   <citas>…</citas>   al principio de una respuesta con observaciones: en
//                      qué se basa (sesión, fecha, frase; una por línea).
//   _(mirando la transcripción del DD/MM)_
//                      una línea sola que escribe el SERVIDOR antes de abrir
//                      una transcripción: es un estado, no algo que dice Lux.

export const ABRE_CITAS = "<citas>";
export const CIERRA_CITAS = "</citas>";

/** La línea de estado, tal como la emite el servidor. */
export function avisoMirandoTranscripcion(diaMes: string): string {
  return `_(mirando la transcripción del ${diaMes})_`;
}

/** El comienzo de esa línea, para no mostrarla a medio llegar. */
export const PREFIJO_AVISO_MIRANDO = "_(mirando la transcripción del ";

/** La línea de estado completa; vale con o sin los guiones bajos (un
 *  lector que limpie Markdown se los come). El grupo 1 es "DD/MM". */
export const LINEA_AVISO_MIRANDO = /^\s*_?\(mirando la transcripción del (\d{1,2}\/\d{1,2})\)_?\s*$/;

/** Un pedazo de una respuesta leída: prosa de Lux o un estado de la app. */
export type BloqueLux =
  | { tipo: "prosa"; texto: string }
  | { tipo: "estado"; fecha: string };

export interface RespuestaLux {
  /** El contenido de <citas>, sin las etiquetas. null si no vino. */
  citas: string | null;
  bloques: BloqueLux[];
}

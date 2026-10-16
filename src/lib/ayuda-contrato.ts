// El contrato de POST /api/ayuda (Lupita), en un solo lugar: lo importan la
// ruta (src/app/api/ayuda/route.ts), el caso de uso (casos-uso/responder-ayuda.ts)
// y el panel (src/components/ayuda/panel-ayuda.tsx). Mismo molde que
// src/lib/lux/contrato.ts.
//
// Lo usan servidor y navegador: no importa nada más que zod.

import { z } from "zod";

/** Largo máximo de una pregunta. Mide caracteres, no tokens: es un tope
 *  contra el pegado accidental de media pantalla, no un control de gasto. */
export const LARGO_MAX_PREGUNTA = 600;

/** Cuántos turnos previos llegan al modelo. Un turno es un mensaje, de
 *  cualquiera de las dos. Con 6 alcanza para un "¿y si no me anduvo?"
 *  encadenado, y el historial nunca crece hasta pesar como el corpus. Lux
 *  usa el mismo número. */
export const MAX_TURNOS_HISTORIAL = 6;

/** Cuántos turnos acepta la ruta y manda el panel. El recorte a los últimos
 *  MAX_TURNOS_HISTORIAL lo hace el caso de uso; acá el tope es contra un
 *  cuerpo enorme, por eso es holgado. */
export const MAX_TURNOS_ENVIADOS = MAX_TURNOS_HISTORIAL * 2;

/** Largo máximo de un turno del historial. Una semana de agenda puede pasarlo:
 *  el panel la conserva entera en pantalla y sólo recorta lo que reenvía. */
export const LARGO_MAX_TURNO = 4000;

export const turnoAyudaSchema = z.object({
  rol: z.enum(["usuaria", "asistente"]),
  texto: z.string().trim().min(1).max(LARGO_MAX_TURNO),
});

export const preguntaAyudaSchema = z.object({
  pregunta: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA),
  historial: z.array(turnoAyudaSchema).max(MAX_TURNOS_ENVIADOS).optional(),
});

/** El status con que la ruta dice que se terminó el cupo del día. */
export const STATUS_TOPE_DIARIO = 429;

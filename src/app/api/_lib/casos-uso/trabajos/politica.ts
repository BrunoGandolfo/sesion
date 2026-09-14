// Política de reintentos de los trabajos durables: backoff y tope por tipo.
// Módulo puro; lo consumen reclamar.ts, resolver.ts y sus tests.

import type { EjecutorTrabajo, TipoTrabajo } from "@prisma/client";

const MIN = 60 * 1000;
const HORA = 60 * MIN;

interface Politica {
  /** Esperas sucesivas; pasado el final de la lista se repite el último. */
  backoffMs: ReadonlyArray<number>;
  /** Intentos tras los cuales el trabajo queda `fallido`. */
  tope: number;
}

export const POLITICA_POR_TIPO: Record<TipoTrabajo, Politica> = {
  // Borrar un objeto que puede tardar en aparecer o en un R2 caído: se
  // insiste mucho tiempo, cada vez más espaciado; a los 20 alerta el cron
  // de salud.
  borrar_audio_r2: {
    backoffMs: [1 * MIN, 5 * MIN, 30 * MIN, 2 * HORA, 6 * HORA, 24 * HORA],
    tope: 20,
  },
  borrar_transcript_asr: {
    backoffMs: [1 * MIN, 5 * MIN, 30 * MIN, 2 * HORA, 6 * HORA, 24 * HORA],
    tope: 20,
  },
  // Una llamada al modelo; al tope, "Para vos" queda `fallido` con botón.
  generar_feedback: { backoffMs: [5 * MIN, 30 * MIN, 2 * HORA], tope: 5 },
  // Diseño 04 §2.4.
  integrar_contexto: {
    backoffMs: [1 * MIN, 5 * MIN, 15 * MIN, 1 * HORA, 3 * HORA, 6 * HORA],
    tope: 6,
  },
};

/** Espera antes del intento siguiente, dado cuántos intentos ya se hicieron
 *  (1 = acaba de fallar el primero). */
export function backoffTrabajoMs(tipo: TipoTrabajo, intentos: number): number {
  const { backoffMs } = POLITICA_POR_TIPO[tipo];
  const indice = Math.min(Math.max(intentos, 1), backoffMs.length) - 1;
  return backoffMs[indice];
}

export function agotado(tipo: TipoTrabajo, intentos: number): boolean {
  return intentos >= POLITICA_POR_TIPO[tipo].tope;
}

/**
 * Cuánto vale un claim sin resultado. El cron de la app ejecuta un borrado
 * en segundos; el worker puede tardar minutos en una llamada al modelo y no
 * renueva el lease de un trabajo.
 */
export const LEASE_TRABAJO_MS: Record<EjecutorTrabajo, number> = {
  app: 2 * MIN,
  worker: 15 * MIN,
};

/** Tope del texto que se guarda en `ultimo_error` (VARCHAR(500)). */
export const ULTIMO_ERROR_MAX = 500;

/** Tipo y mensaje del error, truncados. Nunca contenido. */
export function describirError(error: unknown): string {
  const texto =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return texto.slice(0, ULTIMO_ERROR_MAX);
}

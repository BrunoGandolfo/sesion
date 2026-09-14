// Cuándo se vuelve a intentar un SMS que falló de forma transitoria, y
// cuándo se deja de intentar. Puro.
//
// REEMPLAZA A "TRES INTENTOS". Un tope por cantidad no significa nada: tres
// intentos sin espera entre ellos son quince minutos, y Twilio caído
// quince minutos dejaba todos los recordatorios del día en `fallido`. El
// tope correcto es "hasta que el mensaje deje de servir":
//
//   espera = min(2 min · 2^(intentos−1), 30 min) ± 25 % de jitter
//
//   - mientras el próximo intento caiga ANTES del límite útil, se reintenta;
//   - si la espera lo pasaría de largo pero todavía no se llegó al límite,
//     se hace UN último intento justo en el límite;
//   - llegado el límite, `fallido`;
//   - si el turno ya pasó, `cancelado`: no es una falla del sistema, es un
//     aviso que dejó de tener sentido.
//
// El límite útil de un recordatorio de turno es VENTANA_MINIMA antes de la
// sesión (2 h, decisión del dueño). Para un aviso sin turno (cobro) el que
// llama pasa su propio límite.

export const VENTANA_MINIMA_MS = 2 * 60 * 60_000;

export const ESPERA_BASE_MS = 2 * 60_000;
export const ESPERA_MAXIMA_MS = 30 * 60_000;
export const JITTER = 0.25;

/**
 * Espera antes del intento `intentos + 1`, con `intentos` ya realizados
 * (>= 1). `aleatorio` en [0, 1): se inyecta para que el test sea determinista.
 */
export function esperaMs(intentos: number, aleatorio = Math.random(), jitter = JITTER): number {
  const n = Math.max(1, Math.floor(intentos));
  const base = Math.min(ESPERA_BASE_MS * 2 ** (n - 1), ESPERA_MAXIMA_MS);
  const factor = 1 + (aleatorio * 2 - 1) * jitter;
  return Math.round(base * factor);
}

/** El último instante en que un recordatorio de turno todavía sirve. */
export function limiteUtilDelTurno(fechaTurno: Date): Date {
  return new Date(fechaTurno.getTime() - VENTANA_MINIMA_MS);
}

export type Decision =
  | { accion: "reintentar"; proximoIntentoEn: Date }
  | { accion: "fallido"; motivo: string }
  | { accion: "cancelado"; motivo: string };

export interface ParamsDecision {
  /** Intentos ya realizados, contando el que acaba de fallar. */
  intentos: number;
  ahora: Date;
  /** Último instante útil para mandar. */
  limiteUtil: Date;
  /** Si el aviso es de un turno: la fecha del turno, para el `cancelado`. */
  fechaTurno?: Date | null;
  aleatorio?: number;
  /** Con 429, más dispersión. */
  jitterMayor?: boolean;
}

export const MOTIVO_VENTANA_AGOTADA =
  "no se pudo enviar antes de la sesión: el servicio de SMS no respondió a tiempo";
export const MOTIVO_TURNO_PASADO = "el turno ya pasó";

export function decidirTrasFalloTransitorio({
  intentos,
  ahora,
  limiteUtil,
  fechaTurno,
  aleatorio,
  jitterMayor = false,
}: ParamsDecision): Decision {
  if (fechaTurno && fechaTurno.getTime() <= ahora.getTime()) {
    return { accion: "cancelado", motivo: MOTIVO_TURNO_PASADO };
  }
  if (ahora.getTime() >= limiteUtil.getTime()) {
    return { accion: "fallido", motivo: MOTIVO_VENTANA_AGOTADA };
  }
  const espera = esperaMs(intentos, aleatorio, jitterMayor ? JITTER * 2 : JITTER);
  const proximo = new Date(ahora.getTime() + espera);
  if (proximo.getTime() <= limiteUtil.getTime()) {
    return { accion: "reintentar", proximoIntentoEn: proximo };
  }
  // La espera normal pasaría el límite: un último intento justo ahí.
  return { accion: "reintentar", proximoIntentoEn: limiteUtil };
}

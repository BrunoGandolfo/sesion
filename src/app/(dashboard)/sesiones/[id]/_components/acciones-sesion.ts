// Qué muestra la pantalla de una sesión y qué acciones le ofrece a ella,
// preguntándole a la tabla de operaciones (lib/sesion-clinica/estados.ts) en
// vez de repetirla con literales (forense 03, P3-12 y P3-23).
//
// Módulo puro: la pantalla y sus tests lo importan sin montar nada.

import { estaEnProceso, puede, type EstadoSesion } from "@/lib/sesion-clinica/estados";
import type { EstadoFeedback } from "@/lib/sesion-clinica/schema";

/** El cuerpo de la pantalla según el estado de la sesión. */
export type CuerpoSesion = "escribiendo" | "sin-nota" | "fallida" | "nota";

/**
 * Un `Record` tipado y no una cadena de ternarios: un estado nuevo en el enum
 * no compila hasta que alguien decida qué cuerpo le toca.
 */
export const CUERPO: Record<EstadoSesion, CuerpoSesion> = {
  grabando: "sin-nota",
  subiendo: "escribiendo",
  procesando: "escribiendo",
  revision: "nota",
  aprobada: "nota",
  fallida: "fallida",
};

export function cuerpoDe(estado: EstadoSesion): CuerpoSesion {
  // Lo que está en proceso se escribe, sea cual sea la entrada de la tabla:
  // ESTADOS_EN_PROCESO manda (el test ata las dos).
  return estaEnProceso(estado) ? "escribiendo" : CUERPO[estado];
}

/** Lo que ella puede hacer con la sesión en `estado`, según la tabla. */
export interface AccionesDeUsuaria {
  /** Corregir y aprobar la nota. */
  aprobar: boolean;
  /** "Volver a escribirla" (reprocesar). */
  descartar: boolean;
  /** Reintentar una sesión fallida. */
  reintentar: boolean;
  /** Eliminar una sesión fallida. */
  eliminar: boolean;
}

export function accionesDeUsuaria(estado: EstadoSesion | string): AccionesDeUsuaria {
  return {
    aprobar: puede("aprobar", estado),
    descartar: puede("reprocesar", estado),
    reintentar: puede("reintentar", estado),
    eliminar: puede("eliminar", estado),
  };
}

/**
 * Los estados del "Para vos" desde los que se puede pedir de nuevo. Es la
 * misma lista que FEEDBACK_REPEDIBLE del servidor
 * (casos-uso/sesion/reintentar-feedback.ts), que no se puede importar desde
 * el cliente (arrastra la auditoría y node:crypto); el test ata las dos.
 */
export const FEEDBACK_REPEDIBLE_EN_PANTALLA: ReadonlyArray<EstadoFeedback> = ["fallido", "no_pedido"];

/** ¿Se ofrece "Pedir de nuevo" Para vos? La regla del servidor: la sesión en
 *  un estado donde vale `reintentar_feedback`, el feedback no salió o nunca
 *  se pidió, y hay transcripción de dónde generarlo. */
export function sePuedePedirFeedback(sesion: {
  estado: EstadoSesion | string;
  feedbackEstado: EstadoFeedback;
  modeloAsr: string | null;
}): boolean {
  return (
    puede("reintentar_feedback", sesion.estado) &&
    FEEDBACK_REPEDIBLE_EN_PANTALLA.includes(sesion.feedbackEstado) &&
    sesion.modeloAsr !== null
  );
}

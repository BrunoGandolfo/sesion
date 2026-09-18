// Una grabación es una sucesión de CORRIDAS. Una corrida es lo que captura un
// único MediaRecorder entre un toque de Grabar y la pausa siguiente: un solo
// archivo comprimido, continuo, sin rotación ni solape.
//
// Ese archivo se sube por PIEZAS —los "segmentos" del contrato con el
// servidor—, cortadas en fronteras de entrega. La primera pieza de una corrida
// lleva la cabecera del contenedor y se decodifica sola; las siguientes son
// continuación de la misma corrida y sólo tienen sentido pegadas a la anterior.
// Eso declara `continuacion`, y es lo que el worker usa para saber qué piezas
// concatenar antes de decodificar.
import type { PausaMedida } from "@/lib/sesion-clinica/schema";

/** Cada cuánto se le pide audio al MediaRecorder. Es también la pérdida máxima
 *  ante una muerte del proceso: cada entrega se cifra y se guarda enseguida. */
export const ENTREGA_MS = 1_000;
/** Cuánto audio junta una pieza antes de cerrarse en la entrega siguiente. */
export const SEGMENTO_MS = 60_000;
export const LIMITE_SEGUNDOS = 150 * 60;
export const AVISO_LIMITE_SEGUNDOS = 135 * 60;
export const MAX_SEGMENTOS = 1800;
export const MAX_BYTES_SEGMENTO = 4 * 1024 * 1024;

/** Sin una sola entrega durante este tiempo de página viva, la captura se da
 *  por interrumpida. Es el criterio del grabador anterior a ea5ce74: la prueba
 *  de que el micrófono dejó de entregar es que no entregó, nunca que un
 *  temporizador llegó tarde. */
export const SIN_AUDIO_MS = 60_000;

export interface DescriptorSegmento {
  indice: number;
  iv: string;
  bytes: number;
  sha256: string;
  /** Inicio acumulado del reloj monotónico de captura; las pausas no avanzan este reloj. */
  inicioMs: number;
  /** Esta pieza continúa el archivo de la pieza anterior: no se decodifica
   *  sola. Falso en la primera pieza de cada corrida, y siempre en la 0. */
  continuacion: boolean;
}

/** Pausa entre dos corridas. inicio/fin son desplazamientos del reloj
 * monotónico, nunca horas locales. El índice dice con qué pieza arranca la
 * corrida siguiente. */
export type PausaAudio = PausaMedida;

export interface EstadoAudioRemoto {
  id: string;
  estado: string;
  duracionAudioSeg: number | null;
  pausas: PausaAudio[];
  segmentos: (Omit<DescriptorSegmento, "inicioMs"> & { inicioMs: number | null; confirmado: boolean })[];
}

export function aadSegmento(organizationId: string, sesionId: string, indice: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([organizationId, sesionId, indice]));
}

export function formatearDuracion(segundos: number): string {
  const total = Math.floor(segundos);
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

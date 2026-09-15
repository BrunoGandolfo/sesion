// Segmentos comprimidos independientes. El contenido cifrado no lleva cabecera propia.
import type { PausaMedida } from "@/lib/sesion-clinica/schema";
export const SEGMENTO_MS = 60_000;
export const SOLAPE_MS = 1_000;
export const LIMITE_SEGUNDOS = 150 * 60;
export const AVISO_LIMITE_SEGUNDOS = 135 * 60;
export const MAX_SEGMENTOS = 1800;
export const MAX_BYTES_SEGMENTO = 4 * 1024 * 1024;

export interface DescriptorSegmento {
  indice: number;
  iv: string;
  bytes: number;
  sha256: string;
  /** Inicio acumulado del reloj monotónico de captura; las pausas no avanzan este reloj. */
  inicioMs: number;
}

/** Pausa entre dos capturas: el siguiente segmento arranca sin solape.
 * inicio/fin son desplazamientos del reloj monotónico, nunca horas locales.
 * El índice permite al worker distinguir una reanudación de una rotación. */
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

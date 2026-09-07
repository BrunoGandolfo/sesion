// El cifrado del audio, antes de que salga del dispositivo.
//
// Salió del medio de `procesarGrabacion` en
// src/components/grabacion/GrabadorSesion.tsx. Es el tramo del grabador que
// más importa y el único que era imposible de probar: estaba enterrado entre
// cambios de estado de React, limpieza de refs y liberación del micrófono.
//
// Acá adentro no hay React ni MediaRecorder: entran los chunks capturados y
// sale el paquete cifrado listo para subir. Eso se puede correr en vitest con
// Web Crypto de verdad, sin ningún doble.
//
// LA CLAVE SE GENERA ACÁ Y NO SE GUARDA
//
// AES-GCM de 256 bits, generada en el dispositivo para esta grabación y para
// ninguna otra. Viaja al servidor por separado (upload-url la guarda en
// `datosEstructurados._audioCifradoTemporal`) y se borra cuando la nota se
// aprueba: sin la clave, el blob que quede en R2 es ruido. Ese es el
// crypto-shredding del que depende la eliminación del audio.

import { cifrar, generarClave, base64ABytes } from "@/lib/crypto";

import type { PausaRegistrada } from "@/lib/grabacion-cronometro";

export interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
  /** Tramos en los que la grabación estuvo pausada. */
  pausas: PausaRegistrada[];
}

/**
 * No hay audio que cifrar: la captura no produjo ningún byte.
 *
 * Es un error distinto del de cifrado a propósito. El grabador le dice a la
 * profesional cosas distintas —"no se pudo capturar audio" vs. "no se pudo
 * cifrar, probá de nuevo"— y en el segundo caso reintentar tiene sentido.
 */
export class GrabacionVaciaError extends Error {
  constructor() {
    super("No se pudo capturar audio de la sesión.");
    this.name = "GrabacionVaciaError";
  }
}

export interface CifrarGrabacionParams {
  /** Los trozos que fue entregando el MediaRecorder, en orden. */
  chunks: readonly Blob[];
  /** El mimeType con el que se capturó; sin él, webm. */
  mimeType: string;
  /** Segundos efectivamente grabados (ya calculados, sin las pausas). */
  duracionSegundos: number;
  pausas: PausaRegistrada[];
}

/**
 * Junta los chunks en UN archivo, lo cifra y devuelve el paquete que espera
 * la subida.
 *
 * Lanza `GrabacionVaciaError` si no hay nada que cifrar, y propaga cualquier
 * error de Web Crypto tal cual.
 */
export async function cifrarGrabacion({
  chunks,
  mimeType,
  duracionSegundos,
  pausas,
}: CifrarGrabacionParams): Promise<DatosGrabacion> {
  if (chunks.length === 0) {
    throw new GrabacionVaciaError();
  }

  // Un solo Blob: la pausa manual usa MediaRecorder.pause(), así que todos
  // los chunks pertenecen al mismo archivo y concatenarlos es válido.
  let audioSinCifrar: Blob | null = new Blob([...chunks], {
    type: mimeType || "audio/webm",
  });

  if (audioSinCifrar.size === 0) {
    throw new GrabacionVaciaError();
  }

  const claveCifrado = await generarClave();
  const bufferAudio = await audioSinCifrar.arrayBuffer();
  const { iv, datosCifrados } = await cifrar(bufferAudio, claveCifrado);

  // Se suelta la referencia al audio en claro apenas deja de hacer falta: una
  // sesión de 90 minutos son decenas de megas y el teléfono los tiene tres
  // veces (blob, buffer y cifrado) si no.
  audioSinCifrar = null;

  return {
    audioBlob: new Blob([base64ABytes(datosCifrados)], {
      type: "application/octet-stream",
    }),
    claveCifrado,
    ivCifrado: iv,
    duracionSegundos,
    pausas,
  };
}

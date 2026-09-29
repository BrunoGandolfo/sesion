import { almacenAudio, r2Configurado } from "@/lib/r2";

import type { AlmacenAudio } from "./casos-uso/audio";
import { ApiError } from "./responses";

/**
 * El almacén de audio, o 503 si este entorno no tiene R2 configurado. Lo
 * piden las rutas de la usuaria que no pueden seguir sin R2 (subir,
 * confirmar la subida, descartar una grabación): sin R2 no se puede firmar,
 * ni saber si el audio llegó, y no se adivina.
 *
 * Los crons deciden distinto y no lo usan: el de trabajos contesta 503 con
 * su propio mensaje y el de mantenimiento sigue sin la parte de R2.
 */
export function exigirR2(): AlmacenAudio {
  if (!r2Configurado()) {
    throw new ApiError("El almacenamiento de audio (R2) no está configurado en este entorno", 503);
  }
  return almacenAudio;
}

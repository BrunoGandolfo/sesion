// Ejecuta `borrar_audio_r2`: el único lugar de la app que borra en R2.
//
// "Hecho" no es que el DeleteObject respondió 204 (S3 y R2 responden 204
// también sobre una key inexistente): es que después del borrado un
// HeadObject de cada segmento devuelve 404. Recién ahí la sesión —si todavía
// existe— pasa a `audioEstado = borrado`. La actualización tolera count = 0:
// eliminar ya borró la fila y el trabajo se completa igual.
//
// El payload trae todo lo que hace falta ({ prefijo, indices }) porque los
// segmentos se borran de la base en la misma transacción que la sesión.

import { z } from "zod";

import type { db } from "@/lib/db";

export const payloadBorradoR2Schema = z.object({
  prefijo: z.string().min(1),
  indices: z.array(z.number().int().nonnegative()),
});
export type PayloadBorradoR2 = z.infer<typeof payloadBorradoR2Schema>;

/** Lo que este caso de uso necesita de R2; src/lib/r2.ts lo provee. */
export interface AdaptadorBorradoR2 {
  borrar(key: string): Promise<void>;
  /** true si el objeto sigue existiendo. */
  existe(key: string): Promise<boolean>;
}

export interface EjecutarBorradoR2Input {
  prisma: Pick<typeof db, "sesionClinica">;
  r2: AdaptadorBorradoR2;
  trabajo: { sesionId: string | null; payload: unknown };
  ahora: Date;
  /** Plazo para el trabajo ENTERO; vencido, se corta entre tandas y el
   *  llamador lo reprograma. Lo ya borrado no se pierde: borrar es
   *  idempotente y el reintento sólo repite HeadObjects rápidos. */
  plazoMs?: number;
  reloj?: () => number;
}

export class PlazoAgotadoError extends Error {
  constructor(public readonly hechas: number, public readonly total: number) {
    super(`Plazo agotado: ${hechas} de ${total} llamadas a R2 antes de cortar`);
    this.name = "PlazoAgotadoError";
  }
}

export class AudioNoBorradoError extends Error {
  constructor(public readonly key: string) {
    super(`El objeto ${key} sigue existiendo después del borrado`);
    this.name = "AudioNoBorradoError";
  }
}

export const CONCURRENCIA = 8;

interface Plazo {
  vence: number;
  reloj: () => number;
  hechas: number;
  total: number;
}

async function enTandas<T>(items: T[], plazo: Plazo, accion: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCIA) {
    if (plazo.reloj() > plazo.vence) throw new PlazoAgotadoError(plazo.hechas, plazo.total);
    const tanda = items.slice(i, i + CONCURRENCIA);
    await Promise.all(tanda.map(accion));
    plazo.hechas += tanda.length;
  }
}

/** Keys de los objetos que el trabajo tiene que borrar. */
export function keysDe(payload: PayloadBorradoR2): string[] {
  return payload.indices.map((indice) => `${payload.prefijo}${indice}`);
}

/**
 * Borra cada segmento y verifica que no está. Lanza si alguno sigue ahí o
 * si R2 no contesta: el llamador marca el trabajo para reintentar. Si todo
 * se fue, marca el audio de la sesión como borrado.
 */
export async function ejecutarBorradoR2({
  prisma,
  r2,
  trabajo,
  ahora,
  plazoMs = Number.POSITIVE_INFINITY,
  reloj = () => Date.now(),
}: EjecutarBorradoR2Input): Promise<{ keys: string[] }> {
  const payload = payloadBorradoR2Schema.parse(trabajo.payload);
  const keys = keysDe(payload);
  const plazo: Plazo = { vence: reloj() + plazoMs, reloj, hechas: 0, total: keys.length * 2 };

  // Una grabación larga tiene decenas de segmentos: las llamadas van en
  // tandas de CONCURRENCIA, y entre tanda y tanda se mira el plazo del
  // trabajo entero: el cron tiene que poder resolverlo antes de que Vercel
  // corte la función.
  await enTandas(keys, plazo, (key) => r2.borrar(key));
  await enTandas(keys, plazo, async (key) => {
    if (await r2.existe(key)) throw new AudioNoBorradoError(key);
  });

  if (trabajo.sesionId) {
    await prisma.sesionClinica.updateMany({
      where: { id: trabajo.sesionId, audioEstado: { not: "borrado" } },
      data: { audioEstado: "borrado", audioBorradoEn: ahora },
    });
  }

  return { keys };
}

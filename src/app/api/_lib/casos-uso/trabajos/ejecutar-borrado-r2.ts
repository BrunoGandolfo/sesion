// Ejecuta `borrar_audio_r2`: el único lugar de la app que borra en R2.
//
// Borra TODO lo que hay bajo el prefijo de la sesión (`<org>/<sesion>/`),
// listándolo: no una lista de índices armada de antemano. El grabador de hoy
// sube un solo archivo (`…/0`), pero la época de segmentos dejó `…/1…/N`, y
// un trabajo que sólo conocía el índice 0 los dejaba en el bucket para
// siempre (forense 05, H24).
//
// "Hecho" no es que el DeleteObject respondió 204 (S3 y R2 responden 204
// también sobre una key inexistente): es que después del borrado el listado
// del prefijo vuelve vacío. Recién ahí la sesión —si todavía existe— pasa a
// `audioEstado = borrado`. La actualización tolera count = 0: eliminar ya
// borró la fila y el trabajo se completa igual.
//
// El payload trae el prefijo porque la sesión se borra de la base en la
// misma transacción que crea el trabajo. Los trabajos anteriores traían
// además `indices`: se ignoran, el listado los cubre.

import { z } from "zod";

import type { db } from "@/lib/db";

/** `<org>/<sesion>/`: dos segmentos no vacíos y la barra final. Cualquier
 *  otra cosa podría listar —y borrar— de más, así que ni se intenta. */
export const PREFIJO_DE_SESION = /^[^/]+\/[^/]+\/$/;

export const payloadBorradoR2Schema = z.object({
  prefijo: z.string().regex(PREFIJO_DE_SESION, "El prefijo tiene que ser <org>/<sesion>/"),
});
export type PayloadBorradoR2 = z.infer<typeof payloadBorradoR2Schema>;

/** Lo que este caso de uso necesita de R2; src/lib/r2.ts lo provee. */
export interface AdaptadorBorradoR2 {
  /** Las keys que hay bajo el prefijo, todas (paginando). */
  listar(prefijo: string): Promise<string[]>;
  borrar(key: string): Promise<void>;
}

export interface EjecutarBorradoR2Input {
  prisma: Pick<typeof db, "sesionClinica">;
  r2: AdaptadorBorradoR2;
  trabajo: { sesionId: string | null; payload: unknown };
  ahora: Date;
  /** Plazo para el trabajo ENTERO; vencido, se corta entre tandas y el
   *  llamador lo reprograma. Lo ya borrado no se pierde: el reintento
   *  vuelve a listar y sólo encuentra lo que falta. */
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

function exigirPlazo(plazo: Plazo): void {
  if (plazo.reloj() > plazo.vence) throw new PlazoAgotadoError(plazo.hechas, plazo.total);
}

async function enTandas<T>(items: T[], plazo: Plazo, accion: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCIA) {
    exigirPlazo(plazo);
    const tanda = items.slice(i, i + CONCURRENCIA);
    await Promise.all(tanda.map(accion));
    plazo.hechas += tanda.length;
  }
}

/**
 * Lista el prefijo, borra cada objeto y vuelve a listar. Lanza si algo
 * sigue ahí o si R2 no contesta: el llamador marca el trabajo para
 * reintentar. Si el prefijo quedó vacío, marca el audio de la sesión como
 * borrado. Devuelve las keys que borró.
 */
export async function ejecutarBorradoR2({
  prisma,
  r2,
  trabajo,
  ahora,
  plazoMs = Number.POSITIVE_INFINITY,
  reloj = () => Date.now(),
}: EjecutarBorradoR2Input): Promise<{ keys: string[] }> {
  const { prefijo } = payloadBorradoR2Schema.parse(trabajo.payload);
  const plazo: Plazo = { vence: reloj() + plazoMs, reloj, hechas: 0, total: 2 };

  const keys = await r2.listar(prefijo);
  plazo.hechas += 1;
  plazo.total += keys.length;

  // Las llamadas van en tandas de CONCURRENCIA, y entre tanda y tanda se
  // mira el plazo del trabajo entero: el cron tiene que poder resolverlo
  // antes de que Vercel corte la función.
  await enTandas(keys, plazo, (key) => r2.borrar(key));

  exigirPlazo(plazo);
  const restantes = await r2.listar(prefijo);
  if (restantes.length > 0) throw new AudioNoBorradoError(restantes[0]);

  if (trabajo.sesionId) {
    await prisma.sesionClinica.updateMany({
      where: { id: trabajo.sesionId, audioEstado: { not: "borrado" } },
      data: { audioEstado: "borrado", audioBorradoEn: ahora },
    });
  }

  return { keys };
}

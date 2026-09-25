// Caso de uso: el mantenimiento diario. Tres cosas, y ninguna decide política:
//
//   1. PURGAS operativas a 30 días (las únicas purgas del sistema; nada
//      clínico se borra por antigüedad): intentos_acceso; sesiones_acceso
//      cerradas o vencidas; password_resets e invitaciones usados o
//      vencidos. Y las reservas de recuperación huérfanas (correo nunca
//      confirmado, más de una hora): cuentan contra el cupo mientras existen.
//   2. RE-CIFRADO incremental: filas cuyo blob se cifró con una clave que no
//      es la activa del llavero se descifran y vuelven a cifrar, de a tandas.
//      Es lo que hace posible rotar CLAVES_CIFRADO sin ventana: se agrega la
//      clave nueva, el cron migra, y cuando `pendientes` da 0 se saca la
//      vieja (docs/encryption.md §3). Las versiones inmutables del Recorrido
//      no se reescriben: siguen contando como pendientes y errores. Su clave
//      debe conservarse hasta tener un procedimiento administrativo de rotación.
//   3. RED DE SEGURIDAD de las grabaciones sin terminar: una sesión quieta
//      en `grabando`/`subiendo` más de UMBRAL_HUERFANA_HORAS (siete días) se
//      abandona sola, con la MISMA regla que el botón "Descartar"
//      (casos-uso/sesion/abandonar.ts) y actor sistema. Es lo último que
//      corre: la usuaria la vio en Pendientes mucho antes y tuvo
//      siete días para subirla o descartarla. Solo corre si la ruta le pasa
//      el almacén (R2): sin él no se sabe si hay audio.
//
// El re-cifrado va por SQL crudo: la extensión de Prisma prohíbe (con razón)
// filtrar por una columna cifrada, y acá hay que encontrar las filas por el
// byte 4 del blob (get_byte(col, 4) = id de la clave). El UPDATE también es
// crudo, con el blob recién cifrado para ESA fila (AAD de la fila): es lo
// mismo que verificaría la guarda 2 de la extensión.

import { Prisma } from "@prisma/client";

import { aadDe, cifrar, descifrar, ErrorDescifrado } from "@/lib/encryption";
import { claveActiva } from "@/lib/llavero";
import { CAMPOS_CIFRADOS, MODELOS_CIFRADOS, type ClienteCifrado } from "@/lib/prisma-encryption";
import {
  ESTADOS_SIN_TERMINAR,
  esHuerfana,
  UMBRAL_HUERFANA_HORAS,
} from "@/lib/sesion-clinica/estados";

import type { AlmacenAudio } from "./audio";
import { abandonarSesion } from "./sesion/abandonar";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Retención de las tablas operativas. La única antigüedad que borra algo. */
export const RETENCION_OPERATIVA_DIAS = 30;

/** Una reserva de recuperación sin correo confirmado en una hora es huérfana. */
export const RESERVA_HUERFANA_MS = 60 * 60 * 1000;

/** Filas re-cifradas por corrida del cron. */
export const TOPE_RECIFRADO_POR_CORRIDA = 200;

export interface ResultadoPurga {
  intentosAcceso: number;
  sesionesAcceso: number;
  passwordResets: number;
  reservasHuerfanas: number;
  invitaciones: number;
}

export async function purgarOperativas(prisma: ClienteCifrado, ahora: Date): Promise<ResultadoPurga> {
  const limite = new Date(ahora.getTime() - RETENCION_OPERATIVA_DIAS * MS_POR_DIA);
  const huerfanasAntesDe = new Date(ahora.getTime() - RESERVA_HUERFANA_MS);

  const [intentosAcceso, sesionesAcceso, passwordResets, reservasHuerfanas, invitaciones] = await Promise.all([
    prisma.intentoAcceso.deleteMany({ where: { creadoEn: { lt: limite } } }),
    prisma.sesionAcceso.deleteMany({
      where: { OR: [{ cerradaEn: { lt: limite } }, { venceEn: { lt: limite } }] },
    }),
    prisma.passwordReset.deleteMany({
      where: { OR: [{ usadoEn: { lt: limite } }, { venceEn: { lt: limite } }] },
    }),
    prisma.passwordReset.deleteMany({ where: { enviadoEn: null, creadoEn: { lt: huerfanasAntesDe } } }),
    prisma.invitacion.deleteMany({
      where: { OR: [{ usadaEn: { lt: limite } }, { venceEn: { lt: limite } }] },
    }),
  ]);

  return {
    intentosAcceso: intentosAcceso.count,
    sesionesAcceso: sesionesAcceso.count,
    passwordResets: passwordResets.count,
    reservasHuerfanas: reservasHuerfanas.count,
    invitaciones: invitaciones.count,
  };
}

interface Celda {
  tabla: string;
  columna: string;
}

/** Todas las celdas cifradas del esquema: (tabla, columna SQL). */
export function celdasCifradas(): Celda[] {
  return MODELOS_CIFRADOS.flatMap((modelo) =>
    Object.values(CAMPOS_CIFRADOS[modelo].campos).map((c) => ({
      tabla: CAMPOS_CIFRADOS[modelo].tabla,
      columna: c.columnaSql,
    })),
  );
}

export interface ResultadoRecifrado {
  recifradas: number;
  /** Filas con una clave que no es la activa y que TODAVÍA quedan (contando
   *  después de esta tanda). 0 = se puede sacar la clave vieja. */
  pendientes: number;
  /** Blobs que no se pudieron descifrar o reescribir por inmutabilidad:
   * se dejan como están y se avisa. */
  errores: number;
}

async function contarPendientes(prisma: ClienteCifrado, idActiva: number): Promise<number> {
  let total = 0;
  for (const { tabla, columna } of celdasCifradas()) {
    const [fila] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM ${Prisma.raw(`"${tabla}"`)}
        WHERE ${Prisma.raw(`"${columna}"`)} IS NOT NULL
          AND get_byte(${Prisma.raw(`"${columna}"`)}, 4) <> ${idActiva}`,
    );
    total += Number(fila?.n ?? 0);
  }
  return total;
}

/**
 * Re-cifra hasta `tope` filas cuyo id de clave no sea el activo. Una fila por
 * UPDATE, con el blob nuevo atado a su AAD. Devuelve cuántas quedan.
 */
export async function recifrarTanda(
  prisma: ClienteCifrado,
  tope: number = TOPE_RECIFRADO_POR_CORRIDA,
): Promise<ResultadoRecifrado> {
  const { id: idActiva } = claveActiva();
  let recifradas = 0;
  let errores = 0;

  for (const { tabla, columna } of celdasCifradas()) {
    if (recifradas + errores >= tope) break;
    const filas = await prisma.$queryRaw<{ id: string; blob: Buffer }[]>(
      Prisma.sql`SELECT id, ${Prisma.raw(`"${columna}"`)} AS blob FROM ${Prisma.raw(`"${tabla}"`)}
        WHERE ${Prisma.raw(`"${columna}"`)} IS NOT NULL
          AND get_byte(${Prisma.raw(`"${columna}"`)}, 4) <> ${idActiva}
        LIMIT ${tope - recifradas - errores}`,
    );
    for (const fila of filas) {
      if (tabla === "hilo_versiones") {
        errores += 1;
        console.error(`[mantenimiento] hilo_versiones ${fila.id}: contenido inmutable; conservar la clave anterior`);
        continue;
      }
      const aad = aadDe(tabla, columna, fila.id);
      let texto: string;
      try {
        texto = descifrar(fila.blob, aad);
      } catch (error) {
        if (error instanceof ErrorDescifrado) {
          errores += 1;
          console.error(`[mantenimiento] ${tabla}.${columna} ${fila.id}: no descifra (${error.codigo})`);
          continue;
        }
        throw error;
      }
      const nuevo = cifrar(texto, aad);
      // Condicionado al blob viejo: si alguien escribió la fila en el medio,
      // no se pisa lo nuevo (count 0, y la próxima tanda la vuelve a mirar).
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ${Prisma.raw(`"${tabla}"`)} SET ${Prisma.raw(`"${columna}"`)} = ${nuevo}
          WHERE id = ${fila.id} AND ${Prisma.raw(`"${columna}"`)} = ${fila.blob}`,
      );
      recifradas += 1;
    }
  }

  return { recifradas, pendientes: await contarPendientes(prisma, idActiva), errores };
}

export interface ResultadoHuerfanas {
  /** Tenían audio: quedaron `fallida` con su borrado de R2 encolado. */
  fallidas: number;
  /** No tenían audio: se borraron. */
  borradas: number;
  /** No se pudieron abandonar (R2 no contestó, la fila cambió): se reintenta
   *  en la corrida siguiente. */
  errores: number;
}

/** Tope por corrida: cada una pregunta a R2. Lo que sobra, mañana. */
export const TOPE_HUERFANAS_POR_CORRIDA = 50;

/**
 * Abandona las grabaciones sin terminar que pasaron UMBRAL_HUERFANA_HORAS
 * quietas. La consulta preselecciona por fecha; `esHuerfana` es la regla que
 * decide, la misma de siempre. Una fila que falla no corta las demás.
 */
export async function abandonarHuerfanas(params: {
  prisma: ClienteCifrado;
  almacen: Pick<AlmacenAudio, "existe">;
  ahora: Date;
}): Promise<ResultadoHuerfanas> {
  const { prisma, almacen, ahora } = params;
  const limite = new Date(ahora.getTime() - UMBRAL_HUERFANA_HORAS * 60 * 60 * 1000);
  const candidatas = await prisma.sesionClinica.findMany({
    where: { estado: { in: [...ESTADOS_SIN_TERMINAR] }, actualizadaEn: { lt: limite } },
    select: { id: true, organizationId: true, estado: true, actualizadaEn: true },
    orderBy: { actualizadaEn: "asc" },
    take: TOPE_HUERFANAS_POR_CORRIDA,
  });

  const resultado: ResultadoHuerfanas = { fallidas: 0, borradas: 0, errores: 0 };
  for (const sesion of candidatas) {
    if (!esHuerfana(sesion, ahora)) continue;
    try {
      const { resultado: final } = await abandonarSesion({
        prisma,
        almacen,
        sesionId: sesion.id,
        organizationId: sesion.organizationId,
        actor: { tipo: "sistema" },
        ahora,
      });
      if (final === "fallida") resultado.fallidas += 1;
      else resultado.borradas += 1;
    } catch (error) {
      resultado.errores += 1;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[mantenimiento] no se pudo abandonar la sesión ${sesion.id}: ${msg}`);
    }
  }
  return resultado;
}

export interface ResultadoMantenimiento {
  purga: ResultadoPurga;
  recifrado: ResultadoRecifrado;
  /** Ausente si la corrida no tenía almacén (R2) para decidir. */
  huerfanas?: ResultadoHuerfanas;
}

/**
 * La corrida del cron. Con `todo` re-cifra hasta agotar o hasta que se
 * termine el presupuesto de tiempo (para apurar una rotación a mano).
 */
export async function mantenimiento(params: {
  prisma: ClienteCifrado;
  ahora: Date;
  todo?: boolean;
  presupuestoMs?: number;
  /** R2. Sin él no se abandonan huérfanas: no se sabría si hay audio. */
  almacen?: Pick<AlmacenAudio, "existe">;
}): Promise<ResultadoMantenimiento> {
  const purga = await purgarOperativas(params.prisma, params.ahora);
  const inicio = Date.now();
  let tanda = await recifrarTanda(params.prisma);
  let recifrado = tanda;
  // Solo repetir si la última tanda avanzó y no encontró una fila que requiere
  // intervención. El total acumulado no demuestra progreso en la última tanda.
  while (params.todo && tanda.pendientes > 0 && tanda.recifradas > 0 && tanda.errores === 0) {
    if (Date.now() - inicio > (params.presupuestoMs ?? 50_000)) break;
    const otra = await recifrarTanda(params.prisma);
    tanda = otra;
    recifrado = {
      recifradas: recifrado.recifradas + otra.recifradas,
      pendientes: otra.pendientes,
      errores: recifrado.errores + otra.errores,
    };
  }
  // Lo último: ella tuvo siete días para subirla o descartarla. Si el
  // re-cifrado (`todo`) ya gastó el presupuesto, quedan para mañana.
  const conTiempo = Date.now() - inicio <= (params.presupuestoMs ?? 50_000);
  const huerfanas = params.almacen && conTiempo
    ? await abandonarHuerfanas({ prisma: params.prisma, almacen: params.almacen, ahora: params.ahora })
    : undefined;
  return { purga, recifrado, ...(huerfanas ? { huerfanas } : {}) };
}

// Sesiones de acceso en la base (tabla sesiones_acceso): crear, buscar,
// tocar, cerrar. Reemplaza al JWT de Auth.js, que no se podía apagar.
//
// REGLA DE "VIVA", una sola vez:
//   cerradaEn IS NULL AND venceEn > ahora AND ultimoUsoEn > ahora - 14 días
// `sesionViva()` la evalúa sobre una fila; `whereViva()` la proyecta al SQL.
// Las dos tienen que decir lo mismo: si mañana cambia la regla, cambia acá.
//
// El token de la cookie nunca se guarda: se guarda su sha256 (columna única
// token_hash). Robar la tabla no sirve para entrar.

import type { Prisma } from "@prisma/client";

import { sha256Hex } from "@/lib/crypto";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { VIGENCIA_SESION_SEGUNDOS } from "@/lib/sesion-cookie";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Vencimiento absoluto: 30 días desde la creación. */
export const VIGENCIA_ABSOLUTA_MS = VIGENCIA_SESION_SEGUNDOS * 1000;

/** Sin uso durante 14 días, la sesión muere aunque no haya vencido. */
export const INACTIVIDAD_MAX_MS = 14 * MS_POR_DIA;

/** `ultimoUsoEn` se actualiza como mucho cada 5 minutos, no en cada request. */
export const ACTUALIZAR_USO_CADA_MS = 5 * 60 * 1000;

/** Lo mínimo del cliente que hace falta acá; entra también el de una transacción. */
export type ClienteSesiones = Pick<ClienteCifrado, "sesionAcceso">;

export interface FilaSesion {
  cerradaEn: Date | null;
  venceEn: Date;
  ultimoUsoEn: Date;
}

export function sesionViva(fila: FilaSesion | null, ahora: Date): boolean {
  if (!fila) return false;
  return (
    fila.cerradaEn === null &&
    fila.venceEn.getTime() > ahora.getTime() &&
    fila.ultimoUsoEn.getTime() > ahora.getTime() - INACTIVIDAD_MAX_MS
  );
}

/** La misma regla, como `where` de Prisma. */
export function whereViva(ahora: Date): Prisma.SesionAccesoWhereInput {
  return {
    cerradaEn: null,
    venceEn: { gt: ahora },
    ultimoUsoEn: { gt: new Date(ahora.getTime() - INACTIVIDAD_MAX_MS) },
  };
}

/** 32 bytes aleatorios en base64url. Web Crypto: sirve en cualquier runtime. */
export function nuevoTokenSesion(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const hashTokenSesion = sha256Hex;

export interface CrearSesionParams {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  ahora: Date;
}

export interface SesionCreada {
  /** El token que va a la cookie. Es la única vez que existe en claro. */
  token: string;
  id: string;
  venceEn: Date;
}

export async function crearSesion(
  prisma: ClienteSesiones,
  { userId, ip, userAgent, ahora }: CrearSesionParams,
): Promise<SesionCreada> {
  const token = nuevoTokenSesion();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_ABSOLUTA_MS);
  const sesion = await prisma.sesionAcceso.create({
    data: {
      userId,
      tokenHash: await hashTokenSesion(token),
      creadaEn: ahora,
      ultimoUsoEn: ahora,
      venceEn,
      ip,
      userAgent,
    },
    select: { id: true },
  });
  return { token, id: sesion.id, venceEn };
}

export interface SesionConUsuaria {
  id: string;
  ultimoUsoEn: Date;
  user: {
    id: string;
    organizationId: string;
    rol: "titular";
    nombre: string;
    email: string;
  };
}

/**
 * La sesión viva detrás de un token, con su usuaria. `null` si el token no
 * existe, está cerrado, vencido o inactivo. Una consulta indexada (token_hash
 * es único).
 */
export async function buscarSesionViva(
  prisma: ClienteSesiones,
  token: string,
  ahora: Date,
): Promise<SesionConUsuaria | null> {
  const fila = await prisma.sesionAcceso.findUnique({
    where: { tokenHash: await hashTokenSesion(token) },
    select: {
      id: true,
      cerradaEn: true,
      venceEn: true,
      ultimoUsoEn: true,
      user: { select: { id: true, organizationId: true, rol: true, nombre: true, email: true } },
    },
  });
  if (!sesionViva(fila, ahora)) return null;
  return { id: fila!.id, ultimoUsoEn: fila!.ultimoUsoEn, user: fila!.user };
}

/** Actualiza `ultimoUsoEn` si pasaron más de 5 minutos. Devuelve si escribió. */
export async function tocarSesion(
  prisma: ClienteSesiones,
  sesion: { id: string; ultimoUsoEn: Date },
  ahora: Date,
): Promise<boolean> {
  if (ahora.getTime() - sesion.ultimoUsoEn.getTime() < ACTUALIZAR_USO_CADA_MS) return false;
  await prisma.sesionAcceso.updateMany({
    where: { id: sesion.id, cerradaEn: null },
    data: { ultimoUsoEn: ahora },
  });
  return true;
}

export type MotivoCierre =
  | "salida"
  | "salida_todas"
  | "cambio_password"
  | "restablecimiento"
  | "vencimiento"
  | "incidente";

/** Cierra UNA sesión de la usuaria. `false` si ya estaba cerrada o no es suya. */
export async function cerrarSesion(
  prisma: ClienteSesiones,
  params: { id: string; userId: string; motivo: MotivoCierre; ahora: Date },
): Promise<boolean> {
  const { count } = await prisma.sesionAcceso.updateMany({
    where: { id: params.id, userId: params.userId, cerradaEn: null },
    data: { cerradaEn: params.ahora, motivoCierre: params.motivo },
  });
  return count === 1;
}

/** Cierra todas las sesiones vivas de la usuaria, menos `exceptoId` si viene. */
export async function cerrarTodas(
  prisma: ClienteSesiones,
  params: { userId: string; motivo: MotivoCierre; ahora: Date; exceptoId?: string },
): Promise<number> {
  const { count } = await prisma.sesionAcceso.updateMany({
    where: {
      userId: params.userId,
      cerradaEn: null,
      ...(params.exceptoId ? { id: { not: params.exceptoId } } : {}),
    },
    data: { cerradaEn: params.ahora, motivoCierre: params.motivo },
  });
  return count;
}

/** Las sesiones vivas de la usuaria, para la pantalla "desde dónde estás entrada". Sin IP. */
export async function listarSesionesVivas(
  prisma: ClienteSesiones,
  userId: string,
  ahora: Date,
): Promise<Array<{ id: string; creadaEn: Date; ultimoUsoEn: Date; userAgent: string | null }>> {
  return prisma.sesionAcceso.findMany({
    where: { userId, ...whereViva(ahora) },
    select: { id: true, creadaEn: true, ultimoUsoEn: true, userAgent: true },
    orderBy: { ultimoUsoEn: "desc" },
  });
}

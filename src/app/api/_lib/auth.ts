// Quién está pidiendo: la profesional (sesión en base) o una máquina (Bearer).
//
// SESIÓN DE USUARIA
//
// getSessionActor() lee la cookie, hashea el token, busca la sesión viva en
// sesiones_acceso con su usuaria (una consulta indexada por token_hash) y
// devuelve { userId, organizationId, sesionId, rol, nombre, email }. 401 si
// no hay. Envuelta en cache() de React: una consulta por request aunque la
// llamen varias veces. `ultimoUsoEn` se actualiza si pasaron más de 5
// minutos (una escritura cada tanto, no una por request).
//
// El chequeo de Origin (CSRF) lo hace el proxy para todo lo que pasa por su
// matcher; esOrigenPropio queda exportado desde sesion-cookie para quien
// quiera repetirlo.
//
// MÁQUINA A MÁQUINA
//
// requireM2M: `Authorization: Bearer ${PROCESSING_SECRET}`, donde la variable
// puede ser una LISTA separada por comas para rotar sin ventana de 401
// (Vercel con "viejo,nuevo", Railway con "nuevo", Vercel con "nuevo").
// requireCron: ídem con CRON_SECRET. Comparación en tiempo constante.
//
// El PROCESSING_SECRET solo autoriza a RECLAMAR trabajo. Para escribir en
// una sesión o un trabajo reclamado, el worker usa el ticket que recibió al
// reclamar, y de eso se ocupa _lib/tickets.ts: acá no hay nada de tickets.

import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { cache } from "react";

import { db } from "@/lib/db";
import { buscarSesionViva, tocarSesion } from "@/lib/sesion-acceso";
import { nombreCookie, TOKEN_SESION } from "@/lib/sesion-cookie";

import { ApiError, errorResponse } from "./responses";

export type RolUsuario = "titular";

export interface SessionActor {
  organizationId: string;
  userId: string;
  /** La sesión de acceso con la que entró: es la que "salir" cierra. */
  sesionId: string;
  rol: RolUsuario;
  nombre: string;
  email: string;
}

/**
 * El actor de la sesión, o null si no hay cookie válida. No lanza: sirve al
 * layout del dashboard, que redirige a /login en vez de contestar 401.
 */
export const buscarActor = cache(async (): Promise<SessionActor | null> => {
  const token = (await cookies()).get(nombreCookie())?.value;
  if (!token || !TOKEN_SESION.test(token)) return null;

  const ahora = new Date();
  const sesion = await buscarSesionViva(db, token, ahora);
  if (!sesion) return null;

  try {
    await tocarSesion(db, sesion, ahora);
  } catch (error) {
    // Que no se pueda anotar el uso no puede echar a nadie.
    console.error("[sesion] no se pudo actualizar ultimoUsoEn", error);
  }

  return {
    organizationId: sesion.user.organizationId,
    userId: sesion.user.id,
    sesionId: sesion.id,
    rol: sesion.user.rol,
    nombre: sesion.user.nombre,
    email: sesion.user.email,
  };
});

/** El actor, o 401. La forma que usan las rutas. */
export async function getSessionActor(): Promise<SessionActor> {
  const actor = await buscarActor();
  if (!actor) throw new ApiError("No autorizado", 401);
  return actor;
}

/** Solo la organización (401 sin sesión). */
export async function getOrganizationId(): Promise<string> {
  return (await getSessionActor()).organizationId;
}

// ─── Bearer ─────────────────────────────────────────────────────────────────

/** "a, b,,c" → ["a", "b", "c"]. Vacío si la variable no está. */
export function secretosDe(valor: string | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Comparación de dos strings en tiempo constante. `===` corta en el primer
 * byte distinto y el reloj filtra cuántos caracteres se acertaron;
 * timingSafeEqual recorre siempre los dos buffers enteros. Lo único que
 * sigue distinguiéndose es el largo, que no es el secreto.
 */
function igualEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** El valor después de "Bearer ", o null si no hay header o no es Bearer. */
export function bearerDe(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const valor = header.slice("Bearer ".length);
  return valor.length > 0 ? valor : null;
}

/**
 * ¿El Bearer del request es alguno de los secretos? `null` si autoriza; si
 * no, la respuesta 401. Sin secretos configurados nunca autoriza. Se
 * comparan TODOS los secretos aunque uno ya haya coincidido, para que el
 * tiempo no diga cuál fue.
 */
export function requireBearer(request: Request, secretos: string | undefined): Response | null {
  const noAutorizado = () => errorResponse(new ApiError("No autorizado", 401));
  const lista = secretosDe(secretos);
  if (lista.length === 0) return noAutorizado();
  const recibido = bearerDe(request);
  if (recibido === null) return noAutorizado();
  let ok = false;
  for (const secreto of lista) {
    if (igualEnTiempoConstante(recibido, secreto)) ok = true;
  }
  return ok ? null : noAutorizado();
}

/** Auth del worker para RECLAMAR: PROCESSING_SECRET (lista). */
export function requireM2M(request: Request): Response | null {
  return requireBearer(request, process.env.PROCESSING_SECRET);
}

/** Auth de los crons: CRON_SECRET (lista). */
export function requireCron(request: Request): Response | null {
  return requireBearer(request, process.env.CRON_SECRET);
}

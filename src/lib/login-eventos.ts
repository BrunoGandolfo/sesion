// Eventos de login sobre eventos_auditoria: leer los fallos para el rate
// limit y dejar registrado quién entró, desde dónde y con qué navegador.
//
// Por qué acá y no en src/app/api/_lib/auditoria.ts: ese módulo escribe con
// `db`, el cliente con la extensión de cifrado. El login corre dentro de
// authorize() de Auth.js, que usa `dbAuth` —el cliente liviano, sin
// extensión— justamente para no arrastrar el cifrado a la ruta de auth. Los
// eventos de login no tienen columnas cifradas, así que van por dbAuth.
//
// FORMA DE LOS EVENTOS
//
//   entidad    "login" siempre.
//   entidadId  la CLAVE del contador. Hay dos por intento:
//                "email:<sha256 del email>"  y  "ip:<ip>"
//              El email va hasheado porque es un dato personal y porque el
//              registro no necesita saber cuál era, sólo si es el mismo de
//              antes. La IP va en claro: es la que hay que poder mirar
//              cuando algo pasa, y la consigna pide guardarla.
//   accion     "login.ok" | "login.fallido"
//   detalle    { ip, userAgent, motivo, nivelBloqueoPrevio, fallosPrevios }
//              NUNCA la contraseña, ni su hash, ni el email en claro (la
//              clave "email" está además en la lista negra de detalleSeguro).
//
// Dos filas por fallo, una por clave, para que las dos cuentas —por email y
// por IP— peguen contra el índice (entidad, entidadId) que la tabla ya
// tiene. Sin filtros JSON, sin índice nuevo, sin migración.

import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { dbAuth } from "@/lib/db-auth";
import {
  elMasRestrictivo,
  evaluarBloqueo,
  MEMORIA_HORAS,
  type EstadoBloqueo,
} from "@/lib/login-intentos";

export { huellaDeRequest, type HuellaRequest } from "@/lib/request-huella";

export const ENTIDAD_LOGIN = "login";
export const ACCION_LOGIN_OK = "login.ok";
export const ACCION_LOGIN_FALLIDO = "login.fallido";

/**
 * organizationId de un intento con un email que no existe. La columna es
 * obligatoria y EventoAuditoria no tiene relación con Organization (está
 * dicho en el schema: no se quieren cascadas que borren el rastro), así que
 * un centinela es legal y no rompe ninguna FK.
 */
export const ORG_DESCONOCIDA = "desconocida";

const MS_POR_HORA = 3_600_000;

/** sha256 hex. El email nunca se guarda en claro en el registro. */
function hashEmail(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

export function claveEmail(email: string): string {
  return `email:${hashEmail(email)}`;
}

export function claveIp(ip: string): string {
  return `ip:${ip}`;
}

export interface IntentoLogin {
  /** Ya normalizado: trim + minúsculas. */
  email: string;
  ip: string | null;
  userAgent: string | null;
  ahora: Date;
}

/**
 * ¿Está bloqueado este intento? Una sola consulta trae los fallos de las dos
 * claves y la política (login-intentos.ts) decide.
 *
 * Si la consulta falla, devuelve "no bloqueado": el rate limit no puede
 * dejar afuera a la profesional porque la base tosió. Quien no tiene la
 * contraseña sigue sin poder entrar.
 */
export async function evaluarIntento(
  intento: IntentoLogin,
): Promise<EstadoBloqueo> {
  const claves = [claveEmail(intento.email)];
  if (intento.ip) claves.push(claveIp(intento.ip));

  const desde = new Date(intento.ahora.getTime() - MEMORIA_HORAS * MS_POR_HORA);

  let filas: { entidadId: string; createdAt: Date }[] = [];
  try {
    filas = await dbAuth.eventoAuditoria.findMany({
      where: {
        entidad: ENTIDAD_LOGIN,
        accion: ACCION_LOGIN_FALLIDO,
        entidadId: { in: claves },
        createdAt: { gte: desde },
      },
      select: { entidadId: true, createdAt: true },
    });
  } catch (error) {
    console.error("[login] no se pudieron leer los intentos previos", error);
    return evaluarBloqueo([], intento.ahora);
  }

  const porEmail: Date[] = [];
  const porIp: Date[] = [];
  const kEmail = claveEmail(intento.email);
  for (const fila of filas) {
    (fila.entidadId === kEmail ? porEmail : porIp).push(fila.createdAt);
  }

  return elMasRestrictivo(
    evaluarBloqueo(porEmail, intento.ahora),
    evaluarBloqueo(porIp, intento.ahora),
  );
}

export interface FalloLogin extends IntentoLogin {
  /** Organización del usuario cuando el email existe. */
  organizationId: string | null;
  /** "email" = no existe ese usuario; "password" = existe y no coincide.
   *  Va al registro, nunca a la respuesta: quien prueba no se entera. */
  motivo: "email" | "password";
  /** Cómo estaba el contador ANTES de este fallo (el que dejó pasar el
   *  intento). Se anota para poder leer en el registro cómo venía la cuenta
   *  sin recalcularla; el fallo que se está escribiendo suma uno más. */
  bloqueoPrevio: EstadoBloqueo;
}

/**
 * Registra el intento fallido: una fila por clave (email e IP).
 *
 * Nunca lanza. Un registro que falla no puede convertir un login fallido en
 * un error 500 — pero sí se avisa por consola, porque si esto se rompe el
 * rate limit deja de contar.
 */
export async function registrarLoginFallido(fallo: FalloLogin): Promise<void> {
  const detalle = {
    ip: fallo.ip,
    userAgent: fallo.userAgent,
    motivo: fallo.motivo,
    nivelBloqueoPrevio: fallo.bloqueoPrevio.nivel,
    fallosPrevios: fallo.bloqueoPrevio.fallos,
  } satisfies Prisma.InputJsonObject;

  const organizationId = fallo.organizationId ?? ORG_DESCONOCIDA;
  const claves = [claveEmail(fallo.email)];
  if (fallo.ip) claves.push(claveIp(fallo.ip));

  try {
    await dbAuth.eventoAuditoria.createMany({
      data: claves.map((entidadId) => ({
        organizationId,
        actorTipo: "usuario" as const,
        actorId: null,
        accion: ACCION_LOGIN_FALLIDO,
        entidad: ENTIDAD_LOGIN,
        entidadId,
        detalle,
        createdAt: fallo.ahora,
      })),
    });
  } catch (error) {
    console.error("[login] no se pudo registrar el intento fallido", error);
  }
}

export interface LoginOk extends IntentoLogin {
  userId: string;
  organizationId: string;
}

/**
 * Registra la entrada. Va con `entidadId` = id del usuario y no con la clave
 * del contador: el éxito no es parte de la cuenta de fallos y no la toca.
 * Tampoco la borra — la tabla es append-only.
 */
export async function registrarLoginOk(login: LoginOk): Promise<void> {
  try {
    await dbAuth.eventoAuditoria.create({
      data: {
        organizationId: login.organizationId,
        actorTipo: "usuario",
        actorId: login.userId,
        accion: ACCION_LOGIN_OK,
        entidad: ENTIDAD_LOGIN,
        entidadId: login.userId,
        detalle: {
          ip: login.ip,
          userAgent: login.userAgent,
        } satisfies Prisma.InputJsonObject,
        createdAt: login.ahora,
      },
    });
  } catch (error) {
    console.error("[login] no se pudo registrar la entrada", error);
  }
}

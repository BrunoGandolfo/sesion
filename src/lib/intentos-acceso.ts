// Los intentos FALLIDOS de acceso (tabla intentos_acceso) y los dos intentos
// serializados que los usan: el login y el cambio de contraseña. Reemplaza a
// login-eventos.ts y password-eventos.ts, que contaban sobre
// eventos_auditoria (con IPs adentro y sin purga).
//
// FORMA DE LAS FILAS
//
//   tipo    login | password | recuperar
//   clave   lo que se cuenta: "email:<sha256>", "ip:<ip>", "usuario:<id>",
//           "recuperar-ip:<ip>". El email va hasheado (dato personal).
//   ip, userAgent  de quien golpeó; existen para investigar un incidente y
//           el cron los purga a los 30 días.
//
// Solo fallos: los éxitos no van acá (la entrada queda en sesiones_acceso y
// en eventos_auditoria como cuenta.entrada, sin IP).
//
// LA POLÍTICA es la de src/lib/login-intentos.ts (5 en 15 min, bloqueo
// creciente), y LA SERIALIZACIÓN la de src/lib/intentos-serializados.ts
// (pg_advisory_xact_lock por clave, fail-closed). Ver los porqués ahí.

import type { ITXClientDenyList } from "@prisma/client/runtime/library";

import { sha256Hex } from "@/lib/crypto";
import {
  OPCIONES_TRANSACCION,
  rechazarSiFalla,
  tomarLocks,
} from "@/lib/intentos-serializados";
import {
  elMasRestrictivo,
  evaluarBloqueo,
  MEMORIA_HORAS,
  type EstadoBloqueo,
} from "@/lib/login-intentos";
import type { ClienteCifrado } from "@/lib/prisma-encryption";

/** El cliente de una transacción interactiva del cliente de la app. */
export type TxCifrado = Omit<ClienteCifrado, ITXClientDenyList>;

/** Lo mínimo que hace falta para leer y escribir intentos. */
export type ClienteIntentos = Pick<TxCifrado, "intentoAcceso">;

export type TipoIntento = "login" | "password" | "recuperar";

const MS_POR_HORA = 3_600_000;

export const MENSAJE_DEMASIADOS_INTENTOS =
  "Demasiados intentos. Esperá un rato y probá de nuevo.";

// ─── Claves ─────────────────────────────────────────────────────────────────

export async function claveEmail(email: string): Promise<string> {
  return `email:${await sha256Hex(email)}`;
}
export function claveIp(ip: string): string {
  return `ip:${ip}`;
}
export function claveUsuario(userId: string): string {
  return `usuario:${userId}`;
}
export function claveRecuperarIp(ip: string): string {
  return `recuperar-ip:${ip}`;
}

export interface Huella {
  ip: string | null;
  userAgent: string | null;
}

// ─── Leer y escribir ────────────────────────────────────────────────────────

/**
 * El estado de bloqueo más restrictivo entre las claves dadas. Una consulta.
 * Si la consulta falla devuelve "no bloqueado": el límite no puede dejar
 * afuera a la profesional porque la base tosió; quien no tiene la contraseña
 * sigue sin poder entrar.
 */
export async function evaluarBloqueoDe(
  prisma: ClienteIntentos,
  tipo: TipoIntento,
  claves: readonly string[],
  ahora: Date,
): Promise<EstadoBloqueo> {
  if (claves.length === 0) return evaluarBloqueo([], ahora);
  const desde = new Date(ahora.getTime() - MEMORIA_HORAS * MS_POR_HORA);
  let filas: { clave: string; creadoEn: Date }[] = [];
  try {
    filas = await prisma.intentoAcceso.findMany({
      where: { tipo, clave: { in: [...claves] }, creadoEn: { gte: desde } },
      select: { clave: true, creadoEn: true },
    });
  } catch (error) {
    console.error("[intentos] no se pudieron leer los intentos previos", error);
    return evaluarBloqueo([], ahora);
  }
  const porClave = new Map<string, Date[]>(claves.map((c) => [c, []]));
  for (const fila of filas) porClave.get(fila.clave)?.push(fila.creadoEn);
  return [...porClave.values()]
    .map((fechas) => evaluarBloqueo(fechas, ahora))
    .reduce(elMasRestrictivo);
}

/** Una fila por clave. Nunca lanza: un registro que falla no puede volver un
 *  401 en un 500, pero avisa, porque si esto se rompe el límite deja de contar. */
export async function registrarIntentoFallido(
  prisma: ClienteIntentos,
  params: { tipo: TipoIntento; claves: readonly string[]; huella: Huella; ahora: Date },
): Promise<void> {
  try {
    await prisma.intentoAcceso.createMany({
      data: params.claves.map((clave) => ({
        tipo: params.tipo,
        clave,
        ip: params.huella.ip,
        userAgent: params.huella.userAgent,
        creadoEn: params.ahora,
      })),
    });
  } catch (error) {
    console.error("[intentos] no se pudo registrar el intento fallido", error);
  }
}

// ─── El login, serializado ──────────────────────────────────────────────────

export interface IntentoLogin {
  /** Ya normalizado: trim + minúsculas. */
  email: string;
  huella: Huella;
  ahora: Date;
}

export type Verificacion<T> =
  | { ok: true; resultado: T }
  | { ok: false; motivo: "email" | "password" };

export type ResultadoLogin<T> =
  | { estado: "ok"; resultado: T }
  | { estado: "rechazado" }
  | { estado: "indisponible" };

export interface ProcesarIntentoLoginParams<T> {
  prisma: ClienteCifrado;
  intento: IntentoLogin;
  /**
   * Busca a la usuaria, compara la contraseña y, si es buena, hace lo que
   * haya que hacer en la misma transacción (crear la sesión). Recibe el
   * cliente de la transacción y TIENE que usarlo. Corre con el lock tomado.
   */
  verificar: (tx: TxCifrado) => Promise<Verificacion<T>>;
}

/**
 * Un intento de login completo, serializado por email y por IP. Un intento
 * bloqueado no registra nada y es indistinguible de una contraseña mal. Si
 * la transacción no se puede completar: `indisponible` (fail-closed).
 */
export async function procesarIntentoLogin<T>({
  prisma,
  intento,
  verificar,
}: ProcesarIntentoLoginParams<T>): Promise<ResultadoLogin<T>> {
  return rechazarSiFalla<ResultadoLogin<T>>(
    "login",
    () =>
      prisma.$transaction(async (tx): Promise<ResultadoLogin<T>> => {
        // Orden fijo: email, después IP. Todos arman la lista igual: sin
        // ciclo de espera, sin deadlock.
        const claves = [await claveEmail(intento.email)];
        if (intento.huella.ip) claves.push(claveIp(intento.huella.ip));
        await tomarLocks(tx, claves);

        const bloqueo = await evaluarBloqueoDe(tx, "login", claves, intento.ahora);
        if (bloqueo.bloqueado) return { estado: "rechazado" };

        const verificacion = await verificar(tx);
        if (!verificacion.ok) {
          await registrarIntentoFallido(tx, {
            tipo: "login",
            claves,
            huella: intento.huella,
            ahora: intento.ahora,
          });
          return { estado: "rechazado" };
        }
        return { estado: "ok", resultado: verificacion.resultado };
      }, OPCIONES_TRANSACCION),
    { estado: "indisponible" },
  );
}

// ─── El cambio de contraseña, serializado ───────────────────────────────────

export type ResultadoCambioPassword =
  | { estado: "bloqueado" }
  | { estado: "credencial-incorrecta" }
  | { estado: "sin-usuario" }
  | { estado: "indisponible" }
  | { estado: "ok" };

export interface ProcesarCambioPasswordParams {
  prisma: ClienteCifrado;
  organizationId: string;
  userId: string;
  ahora: Date;
  huella: Huella;
  /** Compara la contraseña actual contra el hash guardado. Corre con el lock. */
  verificar: (hashGuardado: string) => Promise<boolean>;
}

/**
 * Evaluar el contador, comparar la contraseña actual y registrar el fallo
 * son UN acto, serializado por usuaria. Lo que NO hace: escribir la nueva
 * (eso lo hace la ruta después, con sus propios locks).
 */
export async function procesarCambioPassword({
  prisma,
  organizationId,
  userId,
  ahora,
  huella,
  verificar,
}: ProcesarCambioPasswordParams): Promise<ResultadoCambioPassword> {
  return rechazarSiFalla<ResultadoCambioPassword>(
    "cuenta",
    () =>
      prisma.$transaction(async (tx): Promise<ResultadoCambioPassword> => {
        const claves = [claveUsuario(userId)];
        await tomarLocks(tx, claves);

        const bloqueo = await evaluarBloqueoDe(tx, "password", claves, ahora);
        if (bloqueo.bloqueado) return { estado: "bloqueado" };

        const usuario = await tx.user.findFirst({
          where: { id: userId, organizationId },
          select: { hashedPassword: true },
        });
        if (!usuario) return { estado: "sin-usuario" };

        if (await verificar(usuario.hashedPassword)) return { estado: "ok" };

        await registrarIntentoFallido(tx, { tipo: "password", claves, huella, ahora });
        return { estado: "credencial-incorrecta" };
      }, OPCIONES_TRANSACCION),
    { estado: "indisponible" },
  );
}

// ─── Recuperación: bloqueo por IP ───────────────────────────────────────────

/**
 * Un pedido de recuperación desde esta IP. Escribe SIEMPRE una fila (exista
 * o no el email: la IP es lo que se cuenta) y dice si la IP ya está
 * bloqueada. Sin IP no hay qué contar: se deja pasar.
 */
export async function registrarPedidoRecuperar(
  prisma: ClienteCifrado,
  huella: Huella,
  ahora: Date,
): Promise<{ bloqueado: boolean }> {
  if (!huella.ip) return { bloqueado: false };
  const claves = [claveRecuperarIp(huella.ip)];
  return rechazarSiFalla(
    "recuperar",
    () =>
      prisma.$transaction(async (tx) => {
        await tomarLocks(tx, claves);
        const bloqueo = await evaluarBloqueoDe(tx, "recuperar", claves, ahora);
        if (bloqueo.bloqueado) return { bloqueado: true };
        await registrarIntentoFallido(tx, { tipo: "recuperar", claves, huella, ahora });
        return { bloqueado: false };
      }, OPCIONES_TRANSACCION),
    { bloqueado: true },
  );
}

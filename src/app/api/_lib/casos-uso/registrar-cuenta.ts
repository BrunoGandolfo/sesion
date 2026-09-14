// Invitaciones y alta de cuenta. Sin Prisma, bcrypt ni Request: dependencias
// explícitas (RepositorioRegistro lo implementa src/lib/cuenta-registro-db.ts).
import { z } from "zod";

import {
  hashTokenCuenta,
  nuevoTokenCuenta,
  ORIGEN_CUENTA,
  TOKEN_CUENTA,
  tokenVigente,
} from "@/lib/cuenta-tokens";
import {
  ENTRADA_INVITACION_INVALIDA,
  ENTRADA_REGISTRO_ERROR,
  ENTRADA_TERMINOS_REQUERIDOS,
} from "@/lib/glosario";
import { validarPasswordNueva } from "@/lib/password";

import { ApiError } from "../responses";

export const VIGENCIA_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TEMPORAL: tope de invitaciones vigentes por creadora, por costo de APIs
 * durante la prueba. Cuando la prueba termine, este número sube o se saca.
 */
export const MAX_INVITACIONES_VIGENTES = 2;

/**
 * TEMPORAL: quién puede invitar, por costo de APIs durante la prueba. Hoy la
 * cuenta de Mariana, configurable por INVITACIONES_PERMITIDAS (emails
 * separados por coma). Sin la variable nadie invita. Además exige rol
 * titular: cuando haya más roles, la regla es sobre el rol y no sobre la
 * lista.
 */
export function puedeInvitar(
  actor: { rol: string; email: string },
  permitidas: string | undefined = process.env.INVITACIONES_PERMITIDAS,
): boolean {
  if (actor.rol !== "titular") return false;
  const lista = (permitidas ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(actor.email.trim().toLowerCase());
}

export interface InvitacionGuardada {
  id: string;
  creadaPorId: string;
  venceEn: Date;
  usadaEn: Date | null;
}

export interface DatosRegistro {
  token: string;
  nombre: string;
  email: string;
  password: string;
  aceptaTerminos: boolean;
}

export interface SesionNueva {
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RepositorioRegistro {
  /** Cuenta las vigentes de la creadora y crea la nueva en UN acto (lock por
   *  creadora): `null` si ya hay `topeVigentes`. Dos pedidos en paralelo no
   *  pueden superar el tope. */
  crearInvitacion(input: {
    tokenHash: string;
    venceEn: Date;
    creadaEn: Date;
    creadaPorId: string;
    topeVigentes: number;
  }): Promise<{ id: string } | null>;
  buscarInvitacion(tokenHash: string): Promise<InvitacionGuardada | null>;
  /** Crea organización, usuaria, configuración, sesión, consumo de la
   *  invitación y los dos eventos de auditoría, atómicamente. */
  registrar(input: {
    invitacionId: string;
    nombre: string;
    email: string;
    hashedPassword: string;
    ahora: Date;
    sesion: SesionNueva;
  }): Promise<{ userId: string; organizationId: string; sesionId: string }>;
}

export interface ActorInvitante {
  userId: string;
  email: string;
  rol: string;
}

export async function crearInvitacion(
  actor: ActorInvitante,
  repo: RepositorioRegistro,
  ahora = new Date(),
): Promise<{ enlace: string; vence: string; invitacionId: string }> {
  if (!puedeInvitar(actor)) throw new ApiError("No podés invitar desde esta cuenta.", 403);
  const token = nuevoTokenCuenta();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_INVITACION_MS);
  const creada = await repo.crearInvitacion({
    creadaPorId: actor.userId,
    tokenHash: await hashTokenCuenta(token),
    venceEn,
    creadaEn: ahora,
    topeVigentes: MAX_INVITACIONES_VIGENTES,
  });
  if (!creada) {
    throw new ApiError(
      `Ya tenés ${MAX_INVITACIONES_VIGENTES} invitaciones vigentes. Esperá a que se usen o venzan.`,
      429,
    );
  }
  return { enlace: `${ORIGEN_CUENTA}/registro?token=${token}`, vence: venceEn.toISOString(), invitacionId: creada.id };
}

export async function invitacionDisponible(
  token: string,
  repo: RepositorioRegistro,
  ahora = new Date(),
): Promise<InvitacionGuardada | null> {
  if (!TOKEN_CUENTA.test(token)) return null;
  const invitacion = await repo.buscarInvitacion(await hashTokenCuenta(token));
  return invitacion && tokenVigente({ venceEn: invitacion.venceEn, usadoEn: invitacion.usadaEn }, ahora)
    ? invitacion
    : null;
}

export async function registrarCuenta(
  datos: DatosRegistro,
  deps: {
    repo: RepositorioRegistro;
    hashear: (password: string) => Promise<string>;
    /** Token de la sesión que se abre en el alta (nuevoTokenSesion()). */
    tokenSesion: string;
    huella: { ip: string | null; userAgent: string | null };
    hashTokenSesion: (token: string) => Promise<string>;
    ahora?: Date;
  },
): Promise<{ userId: string; organizationId: string; sesionId: string }> {
  if (datos.aceptaTerminos !== true) throw new ApiError(ENTRADA_TERMINOS_REQUERIDOS, 400);
  const email = datos.email.trim().toLowerCase();
  const nombre = datos.nombre.trim();
  if (!nombre || nombre.length > 120 || !z.string().email().max(254).safeParse(email).success) {
    throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
  }
  const validacion = validarPasswordNueva(datos.password);
  if (!validacion.ok) throw new ApiError(validacion.motivo, 400);
  const ahora = deps.ahora ?? new Date();
  const invitacion = await invitacionDisponible(datos.token, deps.repo, ahora);
  if (!invitacion) throw new ApiError(ENTRADA_INVITACION_INVALIDA, 400);
  return deps.repo.registrar({
    invitacionId: invitacion.id,
    nombre,
    email,
    hashedPassword: await deps.hashear(datos.password),
    ahora,
    sesion: {
      tokenHash: await deps.hashTokenSesion(deps.tokenSesion),
      ip: deps.huella.ip,
      userAgent: deps.huella.userAgent,
    },
  });
}

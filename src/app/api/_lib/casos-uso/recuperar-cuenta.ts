// Recuperar y restablecer la contraseña. Sin Prisma, fetch ni bcrypt propios.
//
// EL ORDEN, que es lo que arregla S12 y M-8:
//
//   1. Bloqueo por IP (cada pedido, exista o no el email, cuenta).
//   2. Buscar la usuaria; si no existe, fin.
//   3. Transacción con lock: contar los enlaces ENVIADOS en la última hora;
//      si ≥ 3, fin. Crear la fila con enviadoEn = null.
//   4. Mandar el correo, fuera de la transacción.
//   5. Si salió: enviadoEn = ahora y los enlaces anteriores vivos a usados.
//      Si falló: borrar la fila nueva. Los anteriores siguen vivos y el cupo
//      no se gastó.
//
// Restablecer consume el enlace, cambia la contraseña y cierra TODAS las
// sesiones (motivo restablecimiento). No inicia sesión: la usuaria entra con
// la nueva.

import type { Correo } from "@/lib/correo";
import { plantillaRecuperar } from "@/lib/correo-plantillas";
import {
  hashTokenCuenta,
  nuevoTokenCuenta,
  ORIGEN_CUENTA,
  TOKEN_CUENTA,
  tokenVigente,
} from "@/lib/cuenta-tokens";
import { ENTRADA_ENLACE_INVALIDO, ENTRADA_PASSWORD_DISTINTA } from "@/lib/glosario";
import { validarPasswordNueva } from "@/lib/password";

import { ApiError } from "../responses";

export interface ResetGuardado {
  id: string;
  userId: string;
  organizationId: string;
  hashedPassword: string;
  usadoEn: Date | null;
  venceEn: Date;
  enviadoEn: Date | null;
}

export interface RepositorioRecuperacion {
  /** Escribe el intento por IP y dice si la IP ya está bloqueada. */
  registrarPedido(huella: { ip: string | null; userAgent: string | null }, ahora: Date): Promise<{ bloqueado: boolean }>;
  /** Cuenta los enviados en la última hora bajo lock y crea la fila con
   *  enviadoEn null. null si no existe la usuaria o agotó el cupo. */
  reservarSolicitud(email: string, tokenHash: string, ahora: Date): Promise<{ resetId: string; userId: string; email: string } | null>;
  /** El correo salió: enviadoEn = ahora; los anteriores vivos, usados. */
  confirmarEnvio(resetId: string, userId: string, ahora: Date): Promise<void>;
  /** El correo no salió: la fila se borra, nada cambió. */
  descartarSolicitud(resetId: string): Promise<void>;
  buscar(tokenHash: string): Promise<ResetGuardado | null>;
  /** Compare-and-set: revalida, cambia la contraseña, marca usados los
   *  demás y cierra todas las sesiones, en UNA transacción. */
  consumir(reset: ResetGuardado, hashNuevo: string, ahora: Date): Promise<boolean>;
}

export async function solicitarRecuperacion(
  email: string,
  deps: {
    repo: RepositorioRecuperacion;
    enviar: (correo: Correo) => Promise<void>;
    huella: { ip: string | null; userAgent: string | null };
    ahora?: Date;
    crearToken?: () => string;
  },
): Promise<void> {
  const ahora = deps.ahora ?? new Date();
  const { bloqueado } = await deps.repo.registrarPedido(deps.huella, ahora);
  if (bloqueado) return;

  const token = (deps.crearToken ?? nuevoTokenCuenta)();
  const reserva = await deps.repo.reservarSolicitud(
    email.trim().toLowerCase(),
    await hashTokenCuenta(token),
    ahora,
  );
  if (!reserva) return;

  try {
    await deps.enviar({
      para: reserva.email,
      ...plantillaRecuperar(`${ORIGEN_CUENTA}/restablecer?token=${token}`),
    });
  } catch (error) {
    await deps.repo.descartarSolicitud(reserva.resetId);
    throw error;
  }
  await deps.repo.confirmarEnvio(reserva.resetId, reserva.userId, ahora);
}

export async function restablecerCuenta(
  input: { token: string; password: string },
  deps: {
    repo: RepositorioRecuperacion;
    hashear: (password: string) => Promise<string>;
    comparar: (password: string, hash: string) => Promise<boolean>;
    ahora?: Date;
  },
): Promise<{ userId: string; organizationId: string }> {
  if (!TOKEN_CUENTA.test(input.token)) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  const reset = await deps.repo.buscar(await hashTokenCuenta(input.token));
  const ahora = deps.ahora ?? new Date();
  if (!reset || !tokenVigente(reset, ahora)) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  const validacion = validarPasswordNueva(input.password);
  if (!validacion.ok) throw new ApiError(validacion.motivo, 400);
  if (await deps.comparar(input.password, reset.hashedPassword)) {
    throw new ApiError(ENTRADA_PASSWORD_DISTINTA, 400);
  }
  const hash = await deps.hashear(input.password);
  if (!(await deps.repo.consumir(reset, hash, ahora))) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  return { userId: reset.userId, organizationId: reset.organizationId };
}

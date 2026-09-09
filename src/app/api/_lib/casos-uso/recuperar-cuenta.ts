// Caso de uso sin cliente Prisma, fetch ni bcrypt propios: dependencias explícitas.
import type { Correo } from "@/lib/correo";
import { plantillaRecuperar } from "@/lib/correo-plantillas";
import { hashTokenCuenta, nuevoTokenCuenta, ORIGEN_CUENTA, TOKEN_CUENTA, tokenVigente } from "@/lib/cuenta-tokens";
import { validarPasswordNueva } from "@/lib/password";
import { ENTRADA_ENLACE_INVALIDO, ENTRADA_PASSWORD_DISTINTA } from "@/lib/glosario";
import { ApiError } from "../responses";

export interface ResetGuardado {
  id: string; userId: string; organizationId: string; hashedPassword: string;
  usedAt: Date | null; expiresAt: Date;
}
export interface RepositorioRecuperacion {
  // Debe contar, invalidar y crear en una transacción serializada por usuario.
  crearSolicitud(email: string, tokenHash: string, ahora: Date): Promise<{ email: string } | null>;
  buscar(tokenHash: string): Promise<ResetGuardado | null>;
  // Compare-and-set: revalida vigencia/uso y cambia password en UNA transacción.
  consumir(reset: ResetGuardado, hashNuevo: string, ahora: Date): Promise<boolean>;
}

export async function solicitarRecuperacion(email: string, deps: {
  repo: RepositorioRecuperacion; enviar: (correo: Correo) => Promise<void>;
  ahora?: Date; crearToken?: () => string;
}): Promise<void> {
  const token = (deps.crearToken ?? nuevoTokenCuenta)();
  const usuaria = await deps.repo.crearSolicitud(email.trim().toLowerCase(), await hashTokenCuenta(token), deps.ahora ?? new Date());
  if (!usuaria) return;
  await deps.enviar({ para: usuaria.email, ...plantillaRecuperar(`${ORIGEN_CUENTA}/restablecer?token=${token}`) });
}

export async function restablecerCuenta(input: { token: string; password: string }, deps: {
  repo: RepositorioRecuperacion;
  hashear: (password: string) => Promise<string>;
  comparar: (password: string, hash: string) => Promise<boolean>;
  ahora?: Date;
}): Promise<{ userId: string; organizationId: string }> {
  if (!TOKEN_CUENTA.test(input.token)) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  const reset = await deps.repo.buscar(await hashTokenCuenta(input.token));
  const ahora = deps.ahora ?? new Date();
  if (!reset || !tokenVigente(reset, ahora)) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  const validacion = validarPasswordNueva(input.password);
  if (!validacion.ok) throw new ApiError(validacion.motivo, 400);
  if (await deps.comparar(input.password, reset.hashedPassword)) throw new ApiError(ENTRADA_PASSWORD_DISTINTA, 400);
  const hash = await deps.hashear(input.password);
  if (!await deps.repo.consumir(reset, hash, deps.ahora ?? new Date())) throw new ApiError(ENTRADA_ENLACE_INVALIDO, 400);
  return { userId: reset.userId, organizationId: reset.organizationId };
}

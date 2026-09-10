import { z } from "zod";
import { hashTokenCuenta, nuevoTokenCuenta, ORIGEN_CUENTA, TOKEN_CUENTA, tokenVigente } from "@/lib/cuenta-tokens";
import { validarPasswordNueva } from "@/lib/password";
import { ENTRADA_INVITACION_INVALIDA, ENTRADA_REGISTRO_ERROR, ENTRADA_TERMINOS_REQUERIDOS } from "@/lib/glosario";
import { ApiError } from "../responses";
export const VIGENCIA_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;
export interface InvitacionGuardada {
  id: string; organizationId: string | null; email: string | null;
  expiresAt: Date; usedAt: Date | null;
}
export interface DatosRegistro { token: string; nombre: string; email: string; password: string; aceptaTerminos: boolean }
export interface RepositorioRegistro {
  crearInvitacion(input: { tokenHash: string; expiresAt: Date; createdAt: Date; createdBy: string }): Promise<void>;
  buscarInvitacion(tokenHash: string): Promise<InvitacionGuardada | null>;
  // Crea organización, usuario, configuración, consumo y auditoría atómicamente.
  registrar(input: { invitacionId: string; nombre: string; email: string; hashedPassword: string; ahora: Date }): Promise<{ userId: string; organizationId: string }>;
}
export async function crearInvitacion(createdBy: string, repo: RepositorioRegistro, ahora = new Date()) {
  const token = nuevoTokenCuenta();
  const expiresAt = new Date(ahora.getTime() + VIGENCIA_INVITACION_MS);
  await repo.crearInvitacion({ createdBy, tokenHash: await hashTokenCuenta(token), expiresAt, createdAt: ahora });
  return { enlace: `${ORIGEN_CUENTA}/registro?token=${token}`, vence: expiresAt.toISOString() };
}
export async function invitacionDisponible(token: string, repo: RepositorioRegistro, ahora = new Date()) {
  if (!TOKEN_CUENTA.test(token)) return null;
  const invitacion = await repo.buscarInvitacion(await hashTokenCuenta(token));
  // Esta versión nunca incorpora a la invitada al consultorio de otra persona.
  return invitacion && invitacion.organizationId === null && tokenVigente(invitacion, ahora) ? invitacion : null;
}
export async function registrarCuenta(datos: DatosRegistro, deps: {
  repo: RepositorioRegistro; hashear: (password: string) => Promise<string>; ahora?: Date;
}) {
  if (datos.aceptaTerminos !== true) throw new ApiError(ENTRADA_TERMINOS_REQUERIDOS, 400);
  const email = datos.email.trim().toLowerCase(); const nombre = datos.nombre.trim();
  if (!nombre || nombre.length > 120 || !z.string().email().max(254).safeParse(email).success) throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
  const validacion = validarPasswordNueva(datos.password);
  if (!validacion.ok) throw new ApiError(validacion.motivo, 400);
  const invitacion = await invitacionDisponible(datos.token, deps.repo, deps.ahora ?? new Date());
  if (!invitacion || (invitacion.email !== null && invitacion.email.toLowerCase() !== email)) throw new ApiError(ENTRADA_INVITACION_INVALIDA, 400);
  return deps.repo.registrar({ invitacionId: invitacion.id, nombre, email,
    hashedPassword: await deps.hashear(datos.password), ahora: deps.ahora ?? new Date() });
}

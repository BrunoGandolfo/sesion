// Cambiar la contraseña de la usuaria logueada. Exige la actual (una sesión
// robada no puede convertirse en la cuenta entera) con el mismo límite de
// intentos que el login (intentos-acceso, clave usuario:<id>).
//
// En la MISMA transacción: la contraseña nueva, todos los enlaces de
// recuperación vivos a usados, TODAS las sesiones cerradas (motivo
// cambio_password), incluida la actual, y el rastro. Es el precio de que un
// teléfono perdido o una sesión robada no sobrevivan al cambio.
//
// Vivía en la ruta. Sin Request ni bcrypt propio: hashear y comparar se
// inyectan, como en restablecerCuenta (recuperar-cuenta.ts).

import { ACCIONES } from "@/lib/auditoria-acciones";
import { CUENTA_PASSWORD_INCORRECTA, CUENTA_PASSWORD_NO_DISPONIBLE } from "@/lib/glosario";
import {
  claveUsuario,
  MENSAJE_DEMASIADOS_INTENTOS,
  procesarCambioPassword,
  type Huella,
} from "@/lib/intentos-acceso";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import { validarPasswordNueva } from "@/lib/password";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { cerrarTodas } from "@/lib/sesion-acceso";

import { auditar } from "../auditoria";
import { ApiError } from "../responses";

export interface CambiarPasswordDeps {
  prisma: ClienteCifrado;
  hashear: (password: string) => Promise<string>;
  comparar: (password: string, hash: string) => Promise<boolean>;
  huella: Huella;
  ahora?: Date;
}

/** Devuelve cuántas sesiones cerró (todas, la actual incluida). */
export async function cambiarPassword(
  input: { organizationId: string; userId: string; actual: string; nueva: string },
  deps: CambiarPasswordDeps,
): Promise<{ sesionesCerradas: number }> {
  const { organizationId, userId, actual, nueva } = input;
  const { prisma } = deps;
  const ahora = deps.ahora ?? new Date();

  const resultado = await procesarCambioPassword({
    prisma,
    organizationId,
    userId,
    ahora,
    huella: deps.huella,
    verificar: (hashGuardado) => deps.comparar(actual, hashGuardado),
  });

  if (resultado.estado === "bloqueado") throw new ApiError(MENSAJE_DEMASIADOS_INTENTOS, 429);
  if (resultado.estado === "sin-usuario") throw new ApiError("No autorizado", 401);
  if (resultado.estado === "indisponible") throw new ApiError(CUENTA_PASSWORD_NO_DISPONIBLE, 503);
  if (resultado.estado === "credencial-incorrecta") throw new ApiError(CUENTA_PASSWORD_INCORRECTA, 400);

  const validacion = validarPasswordNueva(nueva, actual);
  if (!validacion.ok) throw new ApiError(validacion.motivo, 400);

  const hashNuevo = await deps.hashear(nueva);

  const sesionesCerradas = await prisma.$transaction(async (tx) => {
    await tomarLocks(tx, [claveUsuario(userId), `recuperar:${userId}`]);
    // Compare-and-set sobre el hash que se verificó arriba: si entre la
    // verificación y esta transacción alguien restableció la contraseña por
    // correo (y cerró las sesiones), este cambio ya no está autorizado y no
    // la pisa.
    const { count } = await tx.user.updateMany({
      where: { id: userId, organizationId, hashedPassword: resultado.hashVerificado },
      data: { hashedPassword: hashNuevo },
    });
    if (count === 0) throw new ApiError("No autorizado", 401);
    await tx.passwordReset.updateMany({ where: { userId, usadoEn: null }, data: { usadoEn: ahora } });
    const cerradas = await cerrarTodas(tx, { userId, motivo: "cambio_password", ahora });
    // Ni la contraseña ni su hash ni la IP: solo que pasó y cuántas sesiones cerró.
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: ACCIONES.cuenta.passwordCambiada,
      entidad: "usuario",
      entidadId: userId,
      creadoEn: ahora,
      detalle: { sesionesCerradas: cerradas },
    });
    return cerradas;
  }, OPCIONES_TRANSACCION);

  return { sesionesCerradas };
}

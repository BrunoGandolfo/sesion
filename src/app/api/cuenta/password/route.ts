// Cambiar la contraseña de la usuaria logueada. Exige la actual (una sesión
// robada no puede convertirse en la cuenta entera) con el mismo límite de
// intentos que el login (intentos-acceso, clave usuario:<id>).
//
// En la MISMA transacción: la contraseña nueva, todos los enlaces de
// recuperación vivos a usados, y TODAS las sesiones cerradas (motivo
// cambio_password), incluida la actual. Es el precio de que un teléfono
// perdido o una sesión robada no sobrevivan al cambio. La respuesta borra la
// cookie y dice `reingresar: true`; la pantalla la manda a /login con aviso.

import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  claveUsuario,
  MENSAJE_DEMASIADOS_INTENTOS,
  procesarCambioPassword,
} from "@/lib/intentos-acceso";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import { BCRYPT_RONDAS, validarPasswordNueva } from "@/lib/password";
import { huellaDeRequest } from "@/lib/request-huella";
import { cerrarTodas } from "@/lib/sesion-acceso";
import { cookieBorrada } from "@/lib/sesion-cookie";

import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

const bodySchema = z.object({
  actual: z.string().min(1, "Falta la contraseña actual"),
  nueva: z.string().min(1, "Falta la contraseña nueva"),
});

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const { actual, nueva } = parsed.data;
    const ahora = new Date();

    const resultado = await procesarCambioPassword({
      prisma: db,
      organizationId,
      userId,
      ahora,
      huella: huellaDeRequest(request),
      verificar: (hashGuardado) => bcrypt.compare(actual, hashGuardado),
    });

    if (resultado.estado === "bloqueado") throw new ApiError(MENSAJE_DEMASIADOS_INTENTOS, 429);
    if (resultado.estado === "sin-usuario") throw new ApiError("No autorizado", 401);
    if (resultado.estado === "indisponible") {
      throw new ApiError("No se pudo procesar el cambio de contraseña en este momento. Probá de nuevo.", 503);
    }
    if (resultado.estado === "credencial-incorrecta") {
      throw new ApiError("La contraseña actual no es correcta", 400);
    }

    const validacion = validarPasswordNueva(nueva, actual);
    if (!validacion.ok) throw new ApiError(validacion.motivo, 400);

    const hashNuevo = await bcrypt.hash(nueva, BCRYPT_RONDAS);

    const cerradas = await db.$transaction(async (tx) => {
      await tomarLocks(tx, [claveUsuario(userId), `recuperar:${userId}`]);
      // Compare-and-set sobre el hash que se verificó arriba: si entre la
      // verificación y esta transacción alguien restableció la contraseña
      // por correo (y cerró las sesiones), este cambio ya no está autorizado
      // y no la pisa.
      const { count } = await tx.user.updateMany({
        where: { id: userId, organizationId, hashedPassword: resultado.hashVerificado },
        data: { hashedPassword: hashNuevo },
      });
      if (count === 0) throw new ApiError("No autorizado", 401);
      await tx.passwordReset.updateMany({ where: { userId, usadoEn: null }, data: { usadoEn: ahora } });
      return cerrarTodas(tx, { userId, motivo: "cambio_password", ahora });
    }, OPCIONES_TRANSACCION);

    // Ni la contraseña ni su hash ni la IP: solo que pasó y cuántas sesiones cerró.
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "cuenta.password_cambiada",
      entidad: "usuario",
      entidadId: userId,
      detalle: { sesionesCerradas: cerradas },
    });

    const respuesta = ok({ cambiada: true, reingresar: true });
    respuesta.headers.append("Set-Cookie", cookieBorrada());
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

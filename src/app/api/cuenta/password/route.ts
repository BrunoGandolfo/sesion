// Cambiar la contraseña de la usuaria logueada.
//
// Exige la contraseña actual: sin eso, una sesión robada (un teléfono
// desbloqueado, una cookie filtrada) se convierte en la cuenta entera.
//
// El hash es el MISMO que usa el login —bcryptjs con BCRYPT_RONDAS, igual que
// el seed que creó el usuario—, así que la contraseña nueva entra por el
// mismo camino que la vieja y no hay dos formatos conviviendo.
//
// Y el LÍMITE también es el mismo que el del login: exigir la contraseña
// actual sin límite de intentos convierte este endpoint en un oráculo para
// quien se lleve una sesión. La política vive en src/lib/login-intentos.ts y
// el contador en src/lib/password-eventos.ts, con el userId como clave.
//
// QUÉ NO INVALIDA
//
// Las sesiones. La sesión es un JWT firmado (session.strategy = "jwt" en
// src/lib/auth.ts): no hay tabla de sesiones que borrar, y el token sigue
// siendo válido hasta que vence. Cerrar la sesión activa sería echar a la
// profesional de su propio teléfono justo después de que hizo lo correcto.
// Los tokens de otros dispositivos tampoco se pueden revocar sin una tabla de
// sesiones o una versión de credencial en el usuario: eso necesita migración
// y está fuera de esta tanda (queda dicho en el reporte).

import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { tomarLocks, OPCIONES_TRANSACCION } from "@/lib/intentos-serializados";
import { BCRYPT_RONDAS, validarPasswordNueva } from "@/lib/password";
import {
  MENSAJE_DEMASIADOS_INTENTOS,
  clavePassword,
  procesarCambioPassword,
} from "@/lib/password-eventos";
import { huellaDeRequest } from "@/lib/request-huella";

import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El schema sólo mira que haya algo: el largo y la diferencia con la actual
// los decide validarPasswordNueva, que es la misma regla que usa el
// formulario. Si el mínimo viviera también acá, serían dos.
const bodySchema = z.object({
  actual: z.string().min(1, "Falta la contraseña actual"),
  nueva: z.string().min(1, "Falta la contraseña nueva"),
});

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const body: unknown = await request.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { actual, nueva } = parsed.data;
    const ahora = new Date();
    const { ip, userAgent } = huellaDeRequest(request);

    // Evaluar el contador, comparar la contraseña actual y registrar el fallo
    // son UN acto, serializado por usuario con un lock de transacción. En
    // tres pasos sueltos, N requests en paralelo con una sesión robada leían
    // todos "0 fallos" y llegaban todos al bcrypt: el umbral existía y no
    // frenaba nada (Codex P1 de #13). La maquinaria es la misma del login.
    const resultado = await procesarCambioPassword({
      prisma: db,
      organizationId,
      userId,
      ahora,
      huella: { ip, userAgent },
      verificar: (hashGuardado) => bcrypt.compare(actual, hashGuardado),
    });

    if (resultado.estado === "bloqueado") {
      throw new ApiError(MENSAJE_DEMASIADOS_INTENTOS, 429);
    }

    if (resultado.estado === "sin-usuario") {
      throw new ApiError("No autorizado", 401);
    }

    if (resultado.estado === "indisponible") {
      // La transacción no se pudo completar y el intento se rechaza sin
      // verificar nada (ver rechazarSiFalla). No es culpa de quien pide:
      // 503 y que reintente.
      throw new ApiError(
        "No se pudo procesar el cambio de contraseña en este momento. Probá de nuevo.",
        503,
      );
    }

    if (resultado.estado === "credencial-incorrecta") {
      // Acá sí se puede ser específico: es su propia cuenta y ya está
      // autenticada. El mensaje genérico del login existe para no revelar qué
      // emails están dados de alta; este dato no revela nada nuevo.
      throw new ApiError("La contraseña actual no es correcta", 400);
    }

    // Validar y hashear quedan AFUERA del lock: son CPU pura, y rechazar una
    // contraseña nueva mal formada no es un intento fallido contra el
    // contador (la actual estaba bien).
    const validacion = validarPasswordNueva(nueva, actual);
    if (!validacion.ok) {
      throw new ApiError(validacion.motivo, 400);
    }

    const hashNuevo = await bcrypt.hash(nueva, BCRYPT_RONDAS);

    // updateMany con la organización en el WHERE, igual que el resto de las
    // escrituras por id (ver los PATCH de paciente, turno y sesión).
    await db.$transaction(async (tx) => {
      // Mismo orden que el contador: password primero, recuperar después.
      // Crear y consumir enlaces toman recuperar; ninguna escritura puede
      // intercalarse entre cambiar la contraseña e invalidar los enlaces.
      await tomarLocks(tx, [clavePassword(userId), `recuperar:${userId}`]);
      const { count } = await tx.user.updateMany({
        where: { id: userId, organizationId },
        data: { hashedPassword: hashNuevo },
      });
      if (count === 0) throw new ApiError("No autorizado", 401);
      await tx.passwordReset.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: ahora },
      });
    }, OPCIONES_TRANSACCION);

    // Ni la contraseña ni su hash van al registro: sólo que pasó, cuándo y
    // desde dónde. (detalleSeguro descartaría igual cualquier objeto anidado,
    // pero la regla se cumple acá, no se delega.)
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "cuenta.password_cambiada",
      entidad: "usuario",
      entidadId: userId,
      detalle: { ip, userAgent },
    });

    return ok({ cambiada: true });
  } catch (error) {
    return errorResponse(error);
  }
}

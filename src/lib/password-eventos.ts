// Rate limit del cambio de contraseña (POST /api/cuenta/password).
//
// POR QUÉ HACE FALTA
//
// La ruta exige la contraseña ACTUAL. Sin límite, una sesión robada —un
// teléfono desbloqueado, una cookie filtrada— se convierte en un oráculo:
// quien la tenga puede probar contraseñas contra ese endpoint todas las
// veces que quiera hasta acertar la actual, y desde ahí se lleva la cuenta
// entera. El login está limitado desde el PR #11; esta puerta quedó abierta.
//
// LA REGLA ES LA MISMA QUE LA DEL LOGIN
//
// No se inventa ninguna política nueva: se llama a `evaluarBloqueo` de
// src/lib/login-intentos.ts, el módulo puro donde vive la única definición de
// "cuántos fallos en cuánto tiempo bloquean y por cuánto". Si mañana el
// umbral cambia, cambia en un solo lugar y las dos puertas se enteran.
//
// EL CONTADOR TAMPOCO ES UNA TABLA NUEVA
//
// Igual que el login, la cuenta sale de `eventos_auditoria`, que ya existe y
// ya está indexada por (entidad, entidadId). La clave es el userId —no el
// email ni la IP—: la sesión ya está autenticada, así que el sujeto es la
// cuenta, no quien golpea. Un evento por fallo:
//
//   entidad    "usuario"
//   entidadId  el userId
//   accion     "cuenta.password_intento_fallido"
//   detalle    { ip, userAgent, nivelBloqueoPrevio, fallosPrevios }
//
// Nunca la contraseña ni su hash. Escribe la ruta, con registrarAuditoria.

import type { db } from "@/lib/db";
import {
  evaluarBloqueo,
  MEMORIA_HORAS,
  type EstadoBloqueo,
} from "@/lib/login-intentos";

type ClientePrisma = typeof db;

const MS_POR_HORA = 3_600_000;

/** Entidad con la que se registran los intentos fallidos. */
export const ENTIDAD_CUENTA = "usuario";

/** Acción del evento de auditoría que hace de contador. */
export const ACCION_PASSWORD_FALLIDO = "cuenta.password_intento_fallido";

/** Lo que ve quien se pasó de la raya. No dice cuántos intentos quedan ni
 *  hasta cuándo: es su propia cuenta, pero el dato no le sirve para nada
 *  bueno a quien está probando con una sesión que no es suya. */
export const MENSAJE_DEMASIADOS_INTENTOS =
  "Demasiados intentos con la contraseña actual. Esperá un rato y probá de nuevo.";

export interface EvaluarCambioPasswordParams {
  prisma: ClientePrisma;
  userId: string;
  ahora: Date;
}

/**
 * ¿Puede esta cuenta seguir probando su contraseña actual?
 *
 * Si la consulta falla devuelve "no bloqueado", igual que el login: el rate
 * limit no puede dejar afuera a la profesional porque la base tosió, y quien
 * no sabe la contraseña actual sigue sin poder cambiarla.
 */
export async function evaluarCambioPassword({
  prisma,
  userId,
  ahora,
}: EvaluarCambioPasswordParams): Promise<EstadoBloqueo> {
  const desde = new Date(ahora.getTime() - MEMORIA_HORAS * MS_POR_HORA);

  try {
    const filas = await prisma.eventoAuditoria.findMany({
      where: {
        entidad: ENTIDAD_CUENTA,
        entidadId: userId,
        accion: ACCION_PASSWORD_FALLIDO,
        createdAt: { gte: desde },
      },
      select: { createdAt: true },
    });
    return evaluarBloqueo(
      filas.map((f) => f.createdAt),
      ahora,
    );
  } catch (error) {
    console.error(
      "[cuenta] no se pudieron leer los intentos de cambio de contraseña",
      error,
    );
    return evaluarBloqueo([], ahora);
  }
}

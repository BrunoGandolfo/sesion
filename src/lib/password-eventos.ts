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
// Nunca la contraseña ni su hash.
//
// Y EL INTENTO SE SERIALIZA, IGUAL QUE EL DEL LOGIN
//
// Contar y registrar en dos pasos sueltos no limita nada: N requests en
// paralelo leen todos "0 fallos" y pasan los N. Codex lo reportó sobre el
// login (PR #11) y después, palabra por palabra, sobre esta puerta (PR #13).
// `procesarCambioPassword` hace de las tres cosas —evaluar, verificar y
// registrar— un solo acto adentro de una transacción con
// pg_advisory_xact_lock sobre la clave del usuario. La disciplina del lock y
// el criterio ante una transacción rota viven en
// src/lib/intentos-serializados.ts, compartidos con el login.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import {
  OPCIONES_TRANSACCION,
  rechazarSiFalla,
  tomarLocks,
} from "@/lib/intentos-serializados";
import {
  evaluarBloqueo,
  MEMORIA_HORAS,
  type EstadoBloqueo,
} from "@/lib/login-intentos";

type ClientePrisma = typeof db;

/**
 * Lo mínimo del cliente que necesitan la lectura del contador y la escritura
 * del fallo. `Pick` y no el cliente entero: adentro de `$transaction` lo que
 * hay es el cliente de la transacción, que no es asignable al completo.
 */
type ClienteEventos = Pick<ClientePrisma, "eventoAuditoria">;

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

/** Clave del contador y del lock. Una sola por intento: el sujeto es la
 *  cuenta, no quien golpea (la sesión ya está autenticada). */
export function clavePassword(userId: string): string {
  return `password:${userId}`;
}

export interface EvaluarCambioPasswordParams {
  prisma: ClienteEventos;
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

export interface HuellaIntento {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Registra un intento fallido de cambio de contraseña. Esa fila ES el
 * contador que lee `evaluarCambioPassword` en el intento siguiente.
 *
 * Escribe la fila directamente y no vía `registrarAuditoria` por la misma
 * razón que login-eventos.ts: tiene que poder escribir con el cliente de la
 * transacción, y `registrarAuditoria` está atado al `db` del módulo. El
 * detalle son cuatro primitivos escritos a mano, así que no hay nada que
 * `detalleSeguro` tuviera que filtrar.
 *
 * Nunca lanza: un registro que falla no puede volver un 400 en un 500. Pero
 * avisa por consola, porque si esto se rompe el rate limit deja de contar.
 */
async function registrarPasswordFallido(
  prisma: ClienteEventos,
  datos: {
    organizationId: string;
    userId: string;
    huella: HuellaIntento;
    bloqueoPrevio: EstadoBloqueo;
    ahora: Date;
  },
): Promise<void> {
  try {
    await prisma.eventoAuditoria.create({
      data: {
        organizationId: datos.organizationId,
        actorTipo: "usuario",
        actorId: datos.userId,
        accion: ACCION_PASSWORD_FALLIDO,
        entidad: ENTIDAD_CUENTA,
        entidadId: datos.userId,
        detalle: {
          ip: datos.huella.ip,
          userAgent: datos.huella.userAgent,
          nivelBloqueoPrevio: datos.bloqueoPrevio.nivel,
          fallosPrevios: datos.bloqueoPrevio.fallos,
        } satisfies Prisma.InputJsonObject,
        createdAt: datos.ahora,
      },
    });
  } catch (error) {
    console.error("[cuenta] no se pudo registrar el intento fallido", error);
  }
}

/**
 * Qué pasó con el intento. Cuatro salidas y ninguna se puede confundir con
 * otra: la ruta traduce cada una a su código.
 */
export type ResultadoCambioPassword =
  | { estado: "bloqueado" }
  | { estado: "credencial-incorrecta" }
  | { estado: "sin-usuario" }
  | { estado: "indisponible" }
  | { estado: "ok" };

export interface ProcesarCambioPasswordParams {
  prisma: ClientePrisma;
  organizationId: string;
  userId: string;
  ahora: Date;
  huella: HuellaIntento;
  /**
   * Compara la contraseña actual contra el hash guardado. Se inyecta —en vez
   * de recibir la contraseña— para que este módulo nunca vea el texto plano,
   * y para que el test no tenga que pagar un bcrypt real.
   *
   * Corre CON el lock tomado: ése es el punto. El bcrypt (decenas de ms) pasa
   * a estar adentro de la transacción y los intentos contra el mismo usuario
   * hacen fila, que es exactamente lo que convierte un ataque en paralelo en
   * uno secuencial — y uno secuencial lo frena el umbral.
   */
  verificar: (hashGuardado: string) => Promise<boolean>;
}

/**
 * Un intento de cambio de contraseña completo, serializado por usuario.
 *
 * Lo que NO hace: escribir la contraseña nueva. Validarla y hashearla son
 * CPU que no tiene por qué correr con el lock tomado, y la escritura es sobre
 * `user`, que no es el contador. La ruta lo hace después del commit.
 *
 * Un intento bloqueado no registra nada: si cada bloqueo contara como fallo,
 * quien tiene la sesión robada podría dejar a la dueña sin poder cambiar su
 * propia contraseña para siempre.
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
        await tomarLocks(tx, [clavePassword(userId)]);

        const bloqueo = await evaluarCambioPassword({
          prisma: tx,
          userId,
          ahora,
        });
        if (bloqueo.bloqueado) return { estado: "bloqueado" };

        const usuario = await tx.user.findFirst({
          where: { id: userId, organizationId },
          select: { hashedPassword: true },
        });

        if (!usuario) return { estado: "sin-usuario" };

        if (await verificar(usuario.hashedPassword)) return { estado: "ok" };

        await registrarPasswordFallido(tx, {
          organizationId,
          userId,
          huella,
          bloqueoPrevio: bloqueo,
          ahora,
        });

        return { estado: "credencial-incorrecta" };
      }, OPCIONES_TRANSACCION),
    { estado: "indisponible" },
  );
}

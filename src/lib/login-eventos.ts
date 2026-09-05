// Eventos de login sobre eventos_auditoria: leer los fallos para el rate
// limit y dejar registrado quién entró, desde dónde y con qué navegador.
//
// Por qué acá y no en src/app/api/_lib/auditoria.ts: ese módulo escribe con
// `db`, el cliente con la extensión de cifrado. El login corre dentro de
// authorize() de Auth.js, que usa `dbAuth` —el cliente liviano, sin
// extensión— justamente para no arrastrar el cifrado a la ruta de auth. Los
// eventos de login no tienen columnas cifradas, así que van por dbAuth.
//
// FORMA DE LOS EVENTOS
//
//   entidad    "login" siempre.
//   entidadId  la CLAVE del contador. Hay dos por intento:
//                "email:<sha256 del email>"  y  "ip:<ip>"
//              El email va hasheado porque es un dato personal y porque el
//              registro no necesita saber cuál era, sólo si es el mismo de
//              antes. La IP va en claro: es la que hay que poder mirar
//              cuando algo pasa, y la consigna pide guardarla.
//   accion     "login.ok" | "login.fallido"
//   detalle    { ip, userAgent, motivo, nivelBloqueoPrevio, fallosPrevios }
//              NUNCA la contraseña, ni su hash, ni el email en claro (la
//              clave "email" está además en la lista negra de detalleSeguro).
//
// Dos filas por fallo, una por clave, para que las dos cuentas —por email y
// por IP— peguen contra el índice (entidad, entidadId) que la tabla ya
// tiene. Sin filtros JSON, sin índice nuevo, sin migración.
//
// ─── POR QUÉ HAY UNA TRANSACCIÓN Y UN LOCK ──────────────────────────────────
//
// Contar y registrar en dos pasos separados no alcanza. Con 50 requests en
// paralelo contra el mismo email, los 50 leen el contador ANTES de que
// ninguno escriba su fallo: los 50 ven "0 fallos", los 50 pasan, y el umbral
// de 5 no frena nada. El límite deja de existir justo contra el único ataque
// que le importa, que es el automatizado.
//
// La solución es serializar el intento entero —evaluar, verificar la
// contraseña y registrar el resultado— por clave. `procesarIntento()` abre
// una transacción, toma `pg_advisory_xact_lock(hashtext(clave))` sobre la
// clave del email y la de la IP, y recién ahí evalúa. El intento siguiente
// contra la misma clave espera a que este commitee, así que lee el contador
// ya actualizado.
//
// La disciplina del lock —qué función de Postgres, en qué orden, con qué
// timeouts, y qué pasa si la transacción no se puede completar— NO vive acá:
// vive en src/lib/intentos-serializados.ts, compartida con el cambio de
// contraseña, que tiene el mismo problema y tenía el mismo agujero.

import type { Prisma } from "@prisma/client";

import { sha256Hex } from "@/lib/crypto";
import { dbAuth } from "@/lib/db-auth";
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

export { huellaDeRequest, type HuellaRequest } from "@/lib/request-huella";

export const ENTIDAD_LOGIN = "login";
export const ACCION_LOGIN_OK = "login.ok";
export const ACCION_LOGIN_FALLIDO = "login.fallido";

/**
 * organizationId de un intento con un email que no existe. La columna es
 * obligatoria y EventoAuditoria no tiene relación con Organization (está
 * dicho en el schema: no se quieren cascadas que borren el rastro), así que
 * un centinela es legal y no rompe ninguna FK.
 */
export const ORG_DESCONOCIDA = "desconocida";

const MS_POR_HORA = 3_600_000;

/** El cliente de una transacción interactiva, o `dbAuth` entero. */
type ClienteLogin = Prisma.TransactionClient;

/**
 * Clave del contador por email: `email:<sha256 hex>`.
 *
 * Es async porque el sha256 sale de Web Crypto (`crypto.subtle.digest`) y no
 * de `node:crypto`: este módulo entra —por el import dinámico de authorize()—
 * en el bundle del middleware, que Vercel empaqueta para el runtime edge,
 * donde `node:*` no existe. El hash es byte a byte el mismo de antes, así que
 * las filas ya escritas en `eventos_auditoria` siguen contando.
 */
export async function claveEmail(email: string): Promise<string> {
  return `email:${await sha256Hex(email)}`;
}

export function claveIp(ip: string): string {
  return `ip:${ip}`;
}

export interface IntentoLogin {
  /** Ya normalizado: trim + minúsculas. */
  email: string;
  ip: string | null;
  userAgent: string | null;
  ahora: Date;
}

/** Las dos claves del contador de un intento. La de IP falta si no vino. */
interface ClavesIntento {
  email: string;
  ip: string | null;
}

async function clavesDe(intento: IntentoLogin): Promise<ClavesIntento> {
  return {
    email: await claveEmail(intento.email),
    ip: intento.ip ? claveIp(intento.ip) : null,
  };
}

function listaDe(claves: ClavesIntento): string[] {
  return claves.ip ? [claves.email, claves.ip] : [claves.email];
}

async function evaluarConClaves(
  prisma: ClienteLogin,
  claves: ClavesIntento,
  ahora: Date,
): Promise<EstadoBloqueo> {
  const desde = new Date(ahora.getTime() - MEMORIA_HORAS * MS_POR_HORA);

  let filas: { entidadId: string; createdAt: Date }[] = [];
  try {
    filas = await prisma.eventoAuditoria.findMany({
      where: {
        entidad: ENTIDAD_LOGIN,
        accion: ACCION_LOGIN_FALLIDO,
        entidadId: { in: listaDe(claves) },
        createdAt: { gte: desde },
      },
      select: { entidadId: true, createdAt: true },
    });
  } catch (error) {
    console.error("[login] no se pudieron leer los intentos previos", error);
    return evaluarBloqueo([], ahora);
  }

  const porEmail: Date[] = [];
  const porIp: Date[] = [];
  for (const fila of filas) {
    (fila.entidadId === claves.email ? porEmail : porIp).push(fila.createdAt);
  }

  return elMasRestrictivo(
    evaluarBloqueo(porEmail, ahora),
    evaluarBloqueo(porIp, ahora),
  );
}

/**
 * ¿Está bloqueado este intento? Una sola consulta trae los fallos de las dos
 * claves y la política (login-intentos.ts) decide.
 *
 * Si la consulta falla, devuelve "no bloqueado": el rate limit no puede
 * dejar afuera a la profesional porque la base tosió. Quien no tiene la
 * contraseña sigue sin poder entrar.
 *
 * Suelta —sin lock ni transacción—: sirve para mirar el estado (un test, un
 * futuro "¿por qué no puedo entrar?"). El camino del login usa
 * procesarIntento, que la llama con el lock ya tomado.
 */
export async function evaluarIntento(
  intento: IntentoLogin,
  prisma: ClienteLogin = dbAuth,
): Promise<EstadoBloqueo> {
  return evaluarConClaves(prisma, await clavesDe(intento), intento.ahora);
}

export interface FalloLogin extends IntentoLogin {
  /** Organización del usuario cuando el email existe. */
  organizationId: string | null;
  /** "email" = no existe ese usuario; "password" = existe y no coincide.
   *  Va al registro, nunca a la respuesta: quien prueba no se entera. */
  motivo: "email" | "password";
  /** Cómo estaba el contador ANTES de este fallo (el que dejó pasar el
   *  intento). Se anota para poder leer en el registro cómo venía la cuenta
   *  sin recalcularla; el fallo que se está escribiendo suma uno más. */
  bloqueoPrevio: EstadoBloqueo;
}

async function registrarFalloConClaves(
  prisma: ClienteLogin,
  fallo: FalloLogin,
  claves: ClavesIntento,
): Promise<void> {
  const detalle = {
    ip: fallo.ip,
    userAgent: fallo.userAgent,
    motivo: fallo.motivo,
    nivelBloqueoPrevio: fallo.bloqueoPrevio.nivel,
    fallosPrevios: fallo.bloqueoPrevio.fallos,
  } satisfies Prisma.InputJsonObject;

  const organizationId = fallo.organizationId ?? ORG_DESCONOCIDA;

  try {
    await prisma.eventoAuditoria.createMany({
      data: listaDe(claves).map((entidadId) => ({
        organizationId,
        actorTipo: "usuario" as const,
        actorId: null,
        accion: ACCION_LOGIN_FALLIDO,
        entidad: ENTIDAD_LOGIN,
        entidadId,
        detalle,
        createdAt: fallo.ahora,
      })),
    });
  } catch (error) {
    console.error("[login] no se pudo registrar el intento fallido", error);
  }
}

/**
 * Registra el intento fallido: una fila por clave (email e IP).
 *
 * Nunca lanza. Un registro que falla no puede convertir un login fallido en
 * un error 500 — pero sí se avisa por consola, porque si esto se rompe el
 * rate limit deja de contar.
 */
export async function registrarLoginFallido(
  fallo: FalloLogin,
  prisma: ClienteLogin = dbAuth,
): Promise<void> {
  try {
    await registrarFalloConClaves(prisma, fallo, await clavesDe(fallo));
  } catch (error) {
    console.error("[login] no se pudo registrar el intento fallido", error);
  }
}

export interface LoginOk extends IntentoLogin {
  userId: string;
  organizationId: string;
}

/**
 * Registra la entrada. Va con `entidadId` = id del usuario y no con la clave
 * del contador: el éxito no es parte de la cuenta de fallos y no la toca.
 * Tampoco la borra — la tabla es append-only.
 */
export async function registrarLoginOk(
  login: LoginOk,
  prisma: ClienteLogin = dbAuth,
): Promise<void> {
  try {
    await prisma.eventoAuditoria.create({
      data: {
        organizationId: login.organizationId,
        actorTipo: "usuario",
        actorId: login.userId,
        accion: ACCION_LOGIN_OK,
        entidad: ENTIDAD_LOGIN,
        entidadId: login.userId,
        detalle: {
          ip: login.ip,
          userAgent: login.userAgent,
        } satisfies Prisma.InputJsonObject,
        createdAt: login.ahora,
      },
    });
  } catch (error) {
    console.error("[login] no se pudo registrar la entrada", error);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// El intento serializado
// ────────────────────────────────────────────────────────────────────────────

/** Qué contestó quien verifica la credencial. */
export type Verificacion<T> =
  | {
      ok: true;
      userId: string;
      organizationId: string;
      /** Lo que devuelve procesarIntento si el intento fue bueno. */
      sesion: T;
    }
  | {
      ok: false;
      motivo: "email" | "password";
      organizationId: string | null;
    };

export interface ProcesarIntentoParams<T> {
  intento: IntentoLogin;
  /**
   * Busca al usuario y compara la contraseña. Recibe el cliente de la
   * transacción y TIENE que usarlo: pedir una conexión aparte del pool
   * mientras esta transacción retiene la suya es la receta para que, con el
   * pool lleno, todos los intentos se queden esperando entre sí.
   *
   * Corre con el lock tomado. Eso cuesta: el bcrypt (decenas de ms) pasa a
   * estar adentro de la transacción, y los intentos contra el mismo email se
   * hacen fila. Es exactamente lo que se busca — un ataque en paralelo se
   * convierte en uno secuencial, y uno secuencial lo frena el umbral.
   */
  verificar: (tx: ClienteLogin) => Promise<Verificacion<T>>;
  prisma?: typeof dbAuth;
}

/**
 * Un intento de login completo, serializado por email y por IP.
 *
 * Devuelve lo que armó `verificar` si la credencial es buena, y `null` en
 * todos los demás casos: bloqueado, email inexistente, contraseña incorrecta.
 * Quien llama no puede distinguirlos, que es el punto.
 *
 * Un intento bloqueado NO registra nada. Si cada intento bloqueado contara
 * como fallo, quien golpea la puerta podría dejar afuera a la profesional
 * para siempre y la tabla crecería sin techo.
 *
 * SI LA TRANSACCIÓN FALLA, SE RECHAZA. Es distinto del criterio de
 * `evaluarIntento`, que ante una consulta rota deja pasar: ahí lo que falla
 * es leer el contador y la contraseña todavía se verifica; acá lo que falla
 * es el mecanismo que garantiza el orden, y dejar pasar sería justamente
 * regalar el bypass que esta función existe para tapar. El costo es real y
 * conviene tenerlo escrito: si Postgres no puede dar una conexión, nadie
 * entra. Con la base caída tampoco se podía leer al usuario, así que el
 * login ya no funcionaba de todos modos.
 */
export async function procesarIntento<T>({
  intento,
  verificar,
  prisma = dbAuth,
}: ProcesarIntentoParams<T>): Promise<T | null> {
  type Resultado = { sesion: T; userId: string; organizationId: string } | null;

  const resultado = await rechazarSiFalla<Resultado>(
    "login",
    () =>
      prisma.$transaction(async (tx): Promise<Resultado> => {
        const claves = await clavesDe(intento);

        // Orden fijo: primero el email, después la IP. Todos los intentos
        // arman la lista igual, así que dos transacciones nunca piden los
        // locks al revés: no hay ciclo de espera y no hay deadlock.
        await tomarLocks(tx, listaDe(claves));

        const bloqueo = await evaluarConClaves(tx, claves, intento.ahora);
        if (bloqueo.bloqueado) return null;

        const verificacion = await verificar(tx);

        if (!verificacion.ok) {
          await registrarFalloConClaves(
            tx,
            {
              ...intento,
              organizationId: verificacion.organizationId,
              motivo: verificacion.motivo,
              bloqueoPrevio: bloqueo,
            },
            claves,
          );
          return null;
        }

        return {
          sesion: verificacion.sesion,
          userId: verificacion.userId,
          organizationId: verificacion.organizationId,
        };
      }, OPCIONES_TRANSACCION),
    null,
  );

  if (!resultado) return null;

  // El registro de la entrada queda AFUERA de la transacción a propósito: no
  // es parte del contador, no necesita el lock, y si fallara adentro
  // abortaría el commit y dejaría afuera a alguien que puso bien la
  // contraseña. Acá, como mucho, se pierde una línea del registro.
  await registrarLoginOk(
    {
      ...intento,
      userId: resultado.userId,
      organizationId: resultado.organizationId,
    },
    prisma,
  );

  return resultado.sesion;
}

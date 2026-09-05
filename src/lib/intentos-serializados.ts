// Cómo se serializa un intento de credencial. Módulo compartido por el login
// (src/lib/login-eventos.ts) y por el cambio de contraseña
// (src/lib/password-eventos.ts).
//
// EL PROBLEMA, UNA VEZ MÁS
//
// Contar los fallos y registrar el nuevo en dos pasos separados no limita
// nada: con N requests en paralelo contra la misma clave, los N leen el
// contador ANTES de que ninguno escriba, los N ven "0 fallos" y pasan. El
// umbral existe pero no frena el único ataque que le importa, que es el
// automatizado. Codex lo reportó primero sobre el login (PR #11) y después
// —palabra por palabra el mismo agujero— sobre el cambio de contraseña
// (PR #13). Que haya aparecido dos veces es la razón de que esto sea un
// módulo y no un patrón que cada puerta copia.
//
// LO QUE ESTE MÓDULO GARANTIZA
//
//   1. El lock es `pg_advisory_xact_lock`, no `pg_advisory_lock`. El de
//      transacción se suelta solo al commit o al rollback: no puede quedar
//      colgado si la función serverless se muere, y sobrevive a un pooler en
//      modo transacción (Neon), donde un lock de sesión sería un bug
//      esperando su turno.
//   2. Las claves se toman SIEMPRE en el orden en que vienen en el array.
//      Mientras todos los llamadores armen ese array de la misma forma, dos
//      transacciones nunca los piden al revés: no hay ciclo de espera y no
//      hay deadlock posible.
//   3. Los timeouts son explícitos. Los defaults de Prisma (2 s de espera por
//      una conexión, 5 s de transacción) se quedan cortos apenas hay unos
//      pocos intentos encolados, y agotarlos NO puede significar "pasa
//      igual".
//   4. Si la transacción no se puede completar, el intento se RECHAZA. Ver
//      `rechazarSiFalla`.
//
// LO QUE NO HACE
//
// No orquesta el intento. Evaluar el contador, verificar la credencial y
// registrar el fallo tienen forma distinta en cada puerta —el login lockea
// por email y por IP, arma un hash señuelo y audita la entrada fuera de la
// transacción; el cambio de contraseña lockea por userId y escribe la
// contraseña nueva después del commit—, y meterlas a la fuerza en una
// función genérica pedía un tipo genérico sobre el cliente Prisma (el liviano
// de auth y el extendido con cifrado son tipos distintos) que no se puede
// verificar sin correr tsc. La regla que no puede divergir es la de arriba;
// la secuencia se lee mejor en cada llamador.

/** Lo mínimo que este módulo necesita de un cliente de transacción. */
export interface EjecutorSql {
  $executeRaw(
    query: TemplateStringsArray,
    ...valores: unknown[]
  ): Promise<number>;
}

/**
 * Cuánto espera un intento a que se libere una conexión del pool, y cuánto
 * puede durar la transacción entera (esperar el lock + un bcrypt).
 */
export const LOCK_MAX_WAIT_MS = 10_000;
export const LOCK_TIMEOUT_MS = 10_000;

/** Opciones de `$transaction` para todo intento serializado. */
export const OPCIONES_TRANSACCION = {
  maxWait: LOCK_MAX_WAIT_MS,
  timeout: LOCK_TIMEOUT_MS,
} as const;

/**
 * Toma el lock de transacción de cada clave, en el orden dado.
 *
 * `hashtext` lleva la clave a los 32 bits que pide la función de Postgres;
 * dos claves distintas pueden caer en el mismo número y serializarse de más,
 * que es inofensivo — nunca de menos.
 */
export async function tomarLocks(
  tx: EjecutorSql,
  claves: readonly string[],
): Promise<void> {
  for (const clave of claves) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
  }
}

/**
 * Corre la transacción de un intento y, si NO se pudo completar, devuelve
 * `respaldo` en vez de propagar el error.
 *
 * FAIL-CLOSED, Y ES A PROPÓSITO. El criterio de las lecturas sueltas del
 * contador es el contrario: si la consulta de fallos previos se rompe, se
 * deja pasar, porque lo que falló es leer el contador y la credencial se
 * verifica igual. Acá lo que falla es el mecanismo que garantiza el ORDEN, y
 * dejar pasar sería regalar exactamente el bypass que esto existe para
 * tapar — y regalarlo justo bajo la carga que lo provoca.
 *
 * El costo es real y conviene tenerlo escrito: si Postgres no puede dar una
 * conexión, nadie entra y nadie cambia su contraseña. Con la base caída
 * tampoco se podía leer al usuario, así que ninguna de las dos cosas
 * funcionaba de todos modos.
 */
export async function rechazarSiFalla<R>(
  etiqueta: string,
  cuerpo: () => Promise<R>,
  respaldo: R,
): Promise<R> {
  try {
    return await cuerpo();
  } catch (error) {
    console.error(
      `[${etiqueta}] el intento no se pudo serializar: se rechaza`,
      error,
    );
    return respaldo;
  }
}

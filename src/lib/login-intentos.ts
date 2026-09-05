// Política de bloqueo del login. Módulo PURO: recibe la lista de fallos y la
// hora, y contesta si hay que dejar entrar. Sin base, sin request, sin env.
//
// POR QUÉ ASÍ
//
// La app corre en Vercel, que es serverless: cada request puede caer en una
// instancia distinta y la memoria del proceso no sobrevive. Un contador en un
// Map de módulo (el patrón de manual) no cuenta nada: dos intentos seguidos
// pueden verse en dos lambdas que no se conocen.
//
// La cuenta se deriva entonces de eventos_auditoria, que ya existe, ya es
// append-only y ya está indexada por (entidad, entidadId). No hace falta
// tabla nueva ni migración: el registro de "hubo un intento fallido" ES el
// contador. Quién lee esa tabla y arma la lista es src/lib/login-eventos.ts;
// acá sólo vive la regla.
//
// LA REGLA
//
//   - 5 fallos dentro de una ventana de 15 minutos bloquean.
//   - El bloqueo crece: 15 min la primera vez, 30 la segunda, 60 la tercera,
//     4 horas de ahí en más. El nivel sale de cuántas veces se cruzó el
//     umbral dentro de la memoria de 24 horas.
//   - El bloqueo se mide desde el ÚLTIMO fallo, no desde el primero: quien
//     sigue probando no acorta su espera.
//   - Un login exitoso NO borra el historial. No puede: la tabla es
//     append-only y no se le hace delete desde la app. Es a propósito —
//     si acertar la contraseña limpiara el contador, bastaría con acertar
//     una vez cada cinco intentos para probar de a cinco para siempre.
//
// El costo de la última regla es real y hay que decirlo: si la profesional
// se equivoca cinco veces en un día, espera 15 minutos aunque después
// recuerde la contraseña. Es el precio de que el contador no se pueda
// limpiar desde afuera.

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 3_600_000;

/** Fallos que bloquean, si caen dentro de la ventana. */
export const UMBRAL_INTENTOS = 5;

/** Ventana en la que se cuentan esos fallos, en minutos. */
export const VENTANA_MIN = 15;

/** Cuánto hacia atrás se mira para calcular el nivel, en horas. */
export const MEMORIA_HORAS = 24;

/**
 * Duración del bloqueo según el nivel, en minutos. El nivel 1 es el primero
 * (5 fallos), el 2 el segundo (10), y así. Más allá del último se repite el
 * último valor: no crece hasta el infinito, porque un bloqueo eterno es una
 * puerta cerrada también para ella.
 */
export const BLOQUEOS_MIN = [15, 30, 60, 240] as const;

export interface EstadoBloqueo {
  bloqueado: boolean;
  /** 0 = nunca se cruzó el umbral. 1, 2, 3… = cuántas veces se cruzó. */
  nivel: number;
  /** Momento en que se libera. `null` cuando no hay bloqueo. */
  hasta: Date | null;
  /** Fallos contados dentro de la memoria de 24 h. */
  fallos: number;
}

const SIN_BLOQUEO: EstadoBloqueo = {
  bloqueado: false,
  nivel: 0,
  hasta: null,
  fallos: 0,
};

/** Minutos que dura el bloqueo de un nivel dado (nivel ≥ 1). */
export function duracionBloqueoMin(nivel: number): number {
  if (nivel < 1) return 0;
  const indice = Math.min(nivel, BLOQUEOS_MIN.length) - 1;
  return BLOQUEOS_MIN[indice];
}

/**
 * ¿Se puede intentar?
 *
 * `fallos` son los instantes de los intentos fallidos de esta clave (un
 * email, o una IP) en cualquier orden; los de más de 24 horas se descartan
 * acá, así el llamador puede pasar lo que le devolvió la consulta sin
 * filtrar.
 *
 * Devuelve `bloqueado: false` cuando los últimos 5 fallos NO entran en 15
 * minutos: cinco errores repartidos a lo largo del día no son un ataque, son
 * una semana difícil.
 */
export function evaluarBloqueo(
  fallos: readonly Date[],
  ahora: Date,
): EstadoBloqueo {
  const desdeMemoria = ahora.getTime() - MEMORIA_HORAS * MS_POR_HORA;

  const enMemoria = fallos
    .map((fecha) => fecha.getTime())
    .filter((t) => t > desdeMemoria && t <= ahora.getTime())
    .sort((a, b) => a - b);

  if (enMemoria.length < UMBRAL_INTENTOS) return SIN_BLOQUEO;

  // Los últimos UMBRAL fallos: si ese tramo no entra en la ventana, el
  // umbral no se cruzó recién y no hay bloqueo que sostener.
  const ultimos = enMemoria.slice(-UMBRAL_INTENTOS);
  const tramo = ultimos[ultimos.length - 1] - ultimos[0];
  if (tramo > VENTANA_MIN * MS_POR_MINUTO) {
    return { ...SIN_BLOQUEO, fallos: enMemoria.length };
  }

  const nivel = Math.floor(enMemoria.length / UMBRAL_INTENTOS);
  const ultimoFallo = enMemoria[enMemoria.length - 1];
  const hasta = new Date(ultimoFallo + duracionBloqueoMin(nivel) * MS_POR_MINUTO);

  return {
    bloqueado: ahora.getTime() < hasta.getTime(),
    nivel,
    hasta,
    fallos: enMemoria.length,
  };
}

/**
 * El más restrictivo de dos estados (el de la IP y el del email). Bloquea si
 * bloquea alguno, y con la espera más larga de las dos.
 */
export function elMasRestrictivo(
  a: EstadoBloqueo,
  b: EstadoBloqueo,
): EstadoBloqueo {
  if (a.bloqueado && b.bloqueado) {
    return (a.hasta?.getTime() ?? 0) >= (b.hasta?.getTime() ?? 0) ? a : b;
  }
  if (a.bloqueado) return a;
  if (b.bloqueado) return b;
  return a.nivel >= b.nivel ? a : b;
}

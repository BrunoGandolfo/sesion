// La máquina de estados de la sesión clínica, como entidad de dominio.
//
// ÚNICA fuente de verdad de qué operaciones existen, desde qué estado valen
// y en qué estado dejan la fila. La consumen `transicionar` (que arma el
// UPDATE condicionado, src/app/api/_lib/casos-uso/sesion/transicion.ts) y las
// pantallas (qué botón ofrecer). Ninguna ruta ni pantalla escribe su propia
// tabla de transiciones; ningún PATCH genérico puede pedir un estado.
//
// Módulo puro: sin Prisma, sin Node. Lo importa código de cliente.
//
// Regla que vale para todas las operaciones: la escritura lleva en el WHERE
// el estado de partida y la organización y, para el worker, el `intento`
// vigente. count = 0 ⇒ 409 y no se toca nada.

import { LIMITE_SEGUNDOS } from "@/lib/grabacion-captura";

import { estadoSesionSchema, type EstadoSesion } from "./schema";

export type { EstadoSesion };

/** Lista cerrada, derivada del enum del contrato. */
export const ESTADOS_SESION: ReadonlyArray<EstadoSesion> =
  estadoSesionSchema.options;

export type ActorOperacion = "usuaria" | "servidor" | "worker" | "sistema";

/**
 * A dónde lleva una operación:
 *   - un estado: la fila pasa a ese estado;
 *   - "mismo": la fila no cambia de estado (renovar el lease, un checkpoint,
 *     pedir "Para vos" de nuevo);
 *   - "borrada": la fila desaparece (eliminar).
 */
export type DestinoOperacion = EstadoSesion | "mismo" | "borrada";

export interface Operacion {
  actor: ActorOperacion;
  /** Estados desde los que vale. Vacío = crea la fila. */
  desde: ReadonlyArray<EstadoSesion>;
  hacia: DestinoOperacion;
}

/**
 * Tabla de transiciones. Las del área 1 (grabación y subida) están para que
 * la máquina sea una sola; sus casos de uso las invocan por nombre a través
 * de `transicionar`.
 */
export const OPERACIONES = {
  // ── Grabación y subida (Área 1) ──────────────────────────────────────────
  crear: { actor: "usuaria", desde: [], hacia: "grabando" },
  empezar_subida: { actor: "servidor", desde: ["grabando"], hacia: "subiendo" },
  volver_a_grabar: { actor: "usuaria", desde: ["subiendo"], hacia: "grabando" },
  /** Única entrada a `procesando`: el audio está completo en R2. */
  audio_listo: { actor: "servidor", desde: ["subiendo"], hacia: "procesando" },
  /** Huérfana con audio: queda `fallida` (código grabacion_abandonada). */
  abandonar: {
    actor: "usuaria",
    desde: ["grabando", "subiendo"],
    hacia: "fallida",
  },
  /** Huérfana sin audio: no queda nada que conservar. */
  abandonar_sin_audio: {
    actor: "usuaria",
    desde: ["grabando", "subiendo"],
    hacia: "borrada",
  },

  // ── Worker ───────────────────────────────────────────────────────────────
  reclamar: { actor: "worker", desde: ["procesando"], hacia: "mismo" },
  renovar_lease: { actor: "worker", desde: ["procesando"], hacia: "mismo" },
  registrar_asr: { actor: "worker", desde: ["procesando"], hacia: "mismo" },
  registrar_transcripcion: {
    actor: "worker",
    desde: ["procesando"],
    hacia: "mismo",
  },
  resultado_nota: { actor: "worker", desde: ["procesando"], hacia: "revision" },
  resultado_fallo_transitorio: {
    actor: "worker",
    desde: ["procesando"],
    hacia: "mismo",
  },
  resultado_fallo_definitivo: {
    actor: "worker",
    desde: ["procesando"],
    hacia: "fallida",
  },
  /** Fallos seguidos ≥ MAX_FALLOS_SEGUIDOS: la app la da por perdida. */
  agotar: { actor: "sistema", desde: ["procesando"], hacia: "fallida" },

  // ── Usuaria ──────────────────────────────────────────────────────────────
  aprobar: { actor: "usuaria", desde: ["revision"], hacia: "aprobada" },
  /** "Volver a escribirla": sin borrar nada, la generación anterior queda
   *  hasta que llegue la siguiente. */
  reprocesar: { actor: "usuaria", desde: ["revision"], hacia: "procesando" },
  reintentar: { actor: "usuaria", desde: ["fallida"], hacia: "procesando" },
  eliminar: { actor: "usuaria", desde: ["fallida"], hacia: "borrada" },
  /** "Pedir de nuevo" Para vos: no toca la nota ni el estado. */
  reintentar_feedback: {
    actor: "usuaria",
    desde: ["revision", "aprobada"],
    hacia: "mismo",
  },
} as const satisfies Record<string, Operacion>;

export type NombreOperacion = keyof typeof OPERACIONES;

export function operacion(nombre: NombreOperacion): Operacion {
  return OPERACIONES[nombre];
}

/** Todas las operaciones, con el tipo ancho (sin las tuplas literales). */
export const LISTA_OPERACIONES: ReadonlyArray<
  Operacion & { nombre: NombreOperacion }
> = (Object.keys(OPERACIONES) as NombreOperacion[]).map((nombre) => ({
  nombre,
  ...(OPERACIONES[nombre] as Operacion),
}));

/** Estados en los que la sesión sigue en el pipeline y conviene seguir
 *  consultando: los que tienen alguna salida automática (servidor, worker o
 *  sistema) y ninguna acción de la usuaria salvo esperar. */
export const ESTADOS_EN_PIPELINE: ReadonlySet<EstadoSesion> = new Set(
  ESTADOS_SESION.filter((estado) =>
    LISTA_OPERACIONES.some(
      (op) => op.actor !== "usuaria" && op.desde.includes(estado),
    ),
  ),
);

// ────────────────────────────────────────────────────────────────────────────
// Audio en R2: la key se calcula, nunca se persiste ni la manda un cliente.
// ────────────────────────────────────────────────────────────────────────────

/** Prefijo de todos los objetos de una sesión: `<org>/<sesion>/`. */
export function prefijoAudio(organizationId: string, sesionId: string): string {
  return `${organizationId}/${sesionId}/`;
}

/** Key del objeto `indice` de una sesión: `<org>/<sesion>/<indice>`. El
 *  grabador sube un solo archivo, el 0; el índice queda por el payload de
 *  borrar_audio_r2, que borra por prefijo e índices. */
export function keyAudio(
  organizationId: string,
  sesionId: string,
  indice: number,
): string {
  return `${prefijoAudio(organizationId, sesionId)}${indice}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Lease, reintentos y backoff del procesamiento principal
// ────────────────────────────────────────────────────────────────────────────

/** Cuánto vale un reclamo del worker sin renovarlo. El worker renueva cada
 *  60 s mientras trabaja (Área 4): un worker muerto se detecta en 5 min. */
export const LEASE_SESION_MS = 5 * 60 * 1000;

/** Fallos transitorios seguidos tras los cuales la sesión pasa a `fallida`
 *  (código `intentos_agotados`). Se resetea al reintentar o reprocesar. */
export const MAX_FALLOS_SEGUIDOS = 5;

const BACKOFF_SESION_MIN = [1, 5, 15, 60, 180] as const;

/** Espera antes de volver a entregar la sesión tras `fallosSeguidos` fallos
 *  transitorios (1 = el primero). */
export function backoffSesionMs(fallosSeguidos: number): number {
  const indice = Math.min(
    Math.max(fallosSeguidos, 1),
    BACKOFF_SESION_MIN.length,
  );
  return BACKOFF_SESION_MIN[indice - 1] * 60 * 1000;
}

export const CODIGO_INTENTOS_AGOTADOS = "intentos_agotados";
/** La grabación no llegó al mínimo: no se transcribe y el audio se borra.
 *  El teléfono ya no la sube, pero una PWA vieja cacheada sí (19/9). */
export const CODIGO_GRABACION_CORTA = "grabacion_corta";
/** La grabación quedó en `grabando`/`subiendo` y se abandonó (la usuaria la
 *  descartó, o el mantenimiento pasados UMBRAL_HUERFANA_HORAS). */
export const CODIGO_GRABACION_ABANDONADA = "grabacion_abandonada";

// ────────────────────────────────────────────────────────────────────────────
// Huérfanas
// ────────────────────────────────────────────────────────────────────────────

/** Pasado este tiempo sin actualización en `grabando` o `subiendo`, el
 *  mantenimiento la abandona solo. Siete días y no horas: mientras la fila
 *  exista el teléfono todavía puede subir la copia que guardó, y abandonarla
 *  antes destruiría una grabación recuperable. La usuaria la ve mucho antes
 *  (esGrabacionSinTerminar) y puede resolverla ella. */
export const UMBRAL_HUERFANA_HORAS = 7 * 24;

const UMBRAL_HUERFANA_MS = UMBRAL_HUERFANA_HORAS * 60 * 60 * 1000;

function aEpochMs(valor: Date | string | null | undefined): number | null {
  if (valor == null) return null;
  const ms = valor instanceof Date ? valor.getTime() : Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Regla única de "sesión huérfana": necesita que alguien haga algo.
 *
 * - `fallida`: siempre (reintentar o eliminar).
 * - `grabando` o `subiendo`: si la última actualización fue hace más de
 *   UMBRAL_HUERFANA_HORAS. Sin fecha no se considera huérfana: nunca se
 *   ofrece abandonar una grabación posiblemente activa.
 */
export function esHuerfana(
  sesion: {
    estado: EstadoSesion | string;
    actualizadaEn?: Date | string | null;
    creadaEn?: Date | string | null;
  },
  ahora: Date = new Date(),
): boolean {
  if (sesion.estado === "fallida") return true;
  if (sesion.estado !== "grabando" && sesion.estado !== "subiendo") {
    return false;
  }
  const referencia = aEpochMs(sesion.actualizadaEn) ?? aEpochMs(sesion.creadaEn);
  if (referencia === null) return false;
  return ahora.getTime() - referencia > UMBRAL_HUERFANA_MS;
}

// ────────────────────────────────────────────────────────────────────────────
// Grabación sin terminar
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cuánto puede estar quieta la fila antes de decirle a la usuaria "Grabación
 * sin terminar". Depende del estado, porque lo que mueve la fila es distinto:
 *
 * - `subiendo`: la subida escribe al empezar y al confirmar. Treinta minutos
 *   quieta es una subida que se cortó.
 * - `grabando`: MIENTRAS SE GRABA NADA LLEGA AL SERVIDOR (el archivo sale
 *   entero al terminar; el latido del grabador es local). Una sesión de 50
 *   minutos en curso está "quieta" desde el minuto cero: con 30 minutos se le
 *   ofrecería descartar una grabación viva. El umbral es el tope de grabación
 *   (LIMITE_SEGUNDOS, 150 min) más el mismo margen de 30.
 *
 * Menos que eso puede estar grabando o subiendo ahora mismo.
 */
export const UMBRAL_SIN_TERMINAR_MINUTOS = 30;

export const UMBRAL_SIN_TERMINAR_MS = UMBRAL_SIN_TERMINAR_MINUTOS * 60 * 1000;

export const UMBRAL_GRABANDO_SIN_TERMINAR_MS =
  LIMITE_SEGUNDOS * 1000 + UMBRAL_SIN_TERMINAR_MS;

/** Estados en los que la grabación todavía no terminó de llegar. */
export const ESTADOS_SIN_TERMINAR: ReadonlyArray<EstadoSesion> = ["grabando", "subiendo"];

/** El umbral de quietud de cada estado sin terminar. */
export function umbralSinTerminarMs(estado: "grabando" | "subiendo"): number {
  return estado === "grabando" ? UMBRAL_GRABANDO_SIN_TERMINAR_MS : UMBRAL_SIN_TERMINAR_MS;
}

/**
 * ¿Esta sesión es una grabación sin terminar? `subiendo` quieta más de 30
 * min, o `grabando` quieta más del tope de grabación más 30 min. Sin fecha,
 * no: nunca se le ofrece descartar una grabación que puede estar activa.
 */
export function esGrabacionSinTerminar(
  sesion: {
    estado?: EstadoSesion | string;
    actualizadaEn?: Date | string | null;
  } | null | undefined,
  ahora: Date,
): boolean {
  if (!sesion || (sesion.estado !== "grabando" && sesion.estado !== "subiendo")) {
    return false;
  }
  const referencia = aEpochMs(sesion.actualizadaEn);
  if (referencia === null) return false;
  return ahora.getTime() - referencia > umbralSinTerminarMs(sesion.estado);
}

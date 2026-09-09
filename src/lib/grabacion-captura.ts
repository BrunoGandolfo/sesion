// La salud de una captura en curso: cuándo avisar y cuándo cortar.
//
// POR QUÉ EXISTE ESTE MÓDULO
//
// El 7 de septiembre de 2026 una sesión de ~120 minutos llegó al worker con
// 90. El celular se bloqueó, el micrófono dejó de entregar señal, y la pista
// NO emitió "ended" ni "mute": para el grabador seguía viva. El cronómetro
// contaba reloj de pared, así que al llegar a LIMITE_SEGUNDOS la app hizo
// exactamente lo mismo que el botón Detener —cifró y subió— sin preguntar.
// Se perdió media hora de sesión y nadie apretó nada.
//
// Las dos decisiones que salieron de ahí viven acá, como funciones puras:
//
//   1. Una pista viva pero muda es una interrupción, aunque el navegador no
//      lo diga. `estadoCaptura` la detecta por ausencia de señal.
//   2. Llegar al límite de tiempo NO completa la grabación. `estadoLimite`
//      dice "avisá" y después "cortá", y cortar significa "interrumpida":
//      el audio queda entero esperando que la profesional decida.
//
// Están acá y no adentro del hook porque son la parte que se puede probar
// sin micrófono, sin React y sin un teléfono bloqueado.
//
// LOS UMBRALES NO SON TÉCNICOS, SON CLÍNICOS
//
// En psicoterapia un silencio de dos minutos puede ser el trabajo mismo. Los
// umbrales con la pantalla a la vista son deliberadamente generosos: cortar
// una sesión por un silencio que era terapéutico es peor que seguir grabando
// nada un rato más. Con la pantalla apagada la lectura se invierte: ahí el
// silencio ya no es de la paciente, es del sistema operativo.

/** Qué hacer con una captura según hace cuánto que no entra sonido. */
export type EstadoCaptura = "ok" | "aviso" | "interrumpir";

/** Qué hacer con una captura según cuánto lleva grabado. */
export type EstadoLimite = "ok" | "aviso" | "limite";

// ────────────────────────────────────────────────────────────────────────────
// Silencio
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pantalla apagada o app en segundo plano: 1 minuto sin señal y se corta.
 *
 * Es el caso del 7/9. Con la pantalla apagada nadie puede ver un aviso, así
 * que avisar no sirve de nada: la única acción útil es dejar la grabación en
 * "interrumpida" antes de que se acumulen horas de nada. Un minuto es corto a
 * propósito — con la pantalla apagada no hay silencio terapéutico que
 * proteger, porque nadie está mirando una sesión por el teléfono bloqueado.
 */
export const SILENCIO_OCULTA_INTERRUMPIR_SEG = 60;

/**
 * Pantalla a la vista: a los 2 minutos se avisa, no se corta.
 *
 * Dos minutos de silencio en sesión son normales. Lo único que se hace es
 * decirlo, para que ella pueda mirar el medidor y decidir. Si el micrófono
 * está bien, ignora el aviso y sigue.
 */
export const SILENCIO_VISIBLE_AVISO_SEG = 120;

/**
 * Pantalla a la vista: a los 5 minutos sí se corta.
 *
 * Cinco minutos seguidos sin que entre un solo sonido ya no es un silencio
 * terapéutico: es un micrófono que no está grabando. Se interrumpe para que
 * ella lo vea y lo resuelva, no para cerrar la sesión.
 */
export const SILENCIO_VISIBLE_INTERRUMPIR_SEG = 300;

/**
 * Qué hacer con una captura que hace `segundosEnSilencio` que no recibe
 * señal, sabiendo si la pantalla está a la vista.
 *
 * Los umbrales son inclusivos: a los 60 segundos exactos con la página
 * oculta ya se interrumpe.
 *
 * Con la página oculta no existe "aviso": un cartel que nadie puede leer no
 * es una decisión, es ruido. O está bien, o se corta.
 */
export function estadoCaptura(
  segundosEnSilencio: number,
  paginaVisible: boolean,
): EstadoCaptura {
  const silencio = Math.max(0, segundosEnSilencio);

  if (!paginaVisible) {
    return silencio >= SILENCIO_OCULTA_INTERRUMPIR_SEG ? "interrumpir" : "ok";
  }

  if (silencio >= SILENCIO_VISIBLE_INTERRUMPIR_SEG) {
    return "interrumpir";
  }

  if (silencio >= SILENCIO_VISIBLE_AVISO_SEG) {
    return "aviso";
  }

  return "ok";
}

// ────────────────────────────────────────────────────────────────────────────
// Límite de duración
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tope de una grabación: 150 minutos.
 *
 * No es un límite clínico sino de tamaño de archivo para la subida: WhisperX
 * no tiene un techo práctico de duración. Antes eran 90 minutos, que se
 * comían las sesiones largas y las de pareja.
 */
export const LIMITE_SEGUNDOS = 9000;

/**
 * A los 135 minutos se avisa que quedan 15.
 *
 * El aviso existe para que llegar al tope no sea nunca una sorpresa: con
 * quince minutos de anticipación ella puede cerrar la sesión cuando le sirve
 * a la sesión, no cuando se le acaba el archivo.
 */
export const AVISO_LIMITE_SEGUNDOS = 8100;

/**
 * Qué hacer con una grabación que lleva `segundosGrabados` capturados.
 *
 * "limite" NO significa completar ni subir: significa pasar a "interrumpida",
 * con el audio entero y la decisión en manos de la profesional. Es la regla
 * que se rompió el 7/9 y la razón por la que esta función existe aparte.
 */
export function estadoLimite(segundosGrabados: number): EstadoLimite {
  if (segundosGrabados >= LIMITE_SEGUNDOS) {
    return "limite";
  }

  if (segundosGrabados >= AVISO_LIMITE_SEGUNDOS) {
    return "aviso";
  }

  return "ok";
}

/**
 * Segundos que faltan para el tope, nunca negativo. Lo usa el texto del
 * aviso ("Quedan 15 minutos de grabación").
 */
export function segundosRestantes(segundosGrabados: number): number {
  return Math.max(0, LIMITE_SEGUNDOS - segundosGrabados);
}

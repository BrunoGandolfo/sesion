// Cuánto se grabó y dónde hay huecos, medido por lo único que es evidencia de
// audio: los chunks que entrega el MediaRecorder.
//
// POR QUÉ NO EL RELOJ NI EL MEDIDOR
//
// El 7 y el 18 de septiembre de 2026 el teléfono se bloqueó a mitad de sesión.
// La página quedó congelada: no corrió ningún temporizador y no entró audio.
// El cronómetro contaba reloj de pared, así que el tope "saltó" a los 170
// minutos, en el segundo en que se desbloqueó, y la duración informada no era
// la del audio. El medidor (RMS) tampoco sirve para decidir: con la página
// oculta el AudioContext se suspende y la muestra queda congelada.
//
// Un chunk que llegó es audio que existe. Todo lo demás es una suposición.
// Estas funciones son puras: se prueban sin micrófono ni teléfono.

/** Tope de una grabación: 150 minutos de audio recibido. */
export const LIMITE_SEGUNDOS = 9000;
/** A los 135 minutos se avisa que quedan 15. */
export const AVISO_LIMITE_SEGUNDOS = 8100;
/** Cada cuánto se le pide audio al MediaRecorder. */
export const TIMESLICE_MS = 1000;
/** Sin chunks por más de esto, hay un hueco que contarle a la profesional. */
export const HUECO_MS = 5000;
/** Dos chunks separados por menos de esto llegaron en ráfaga: el navegador
 *  los tenía guardados y los soltó juntos al volver a correr la página. */
const RAFAGA_MS = 500;
/** Pantalla a la vista y el medidor en cero hace dos minutos: se AVISA. Nunca
 *  corta nada: en sesión un silencio largo puede ser el trabajo mismo. */
export const SILENCIO_AVISO_SEG = 120;

/**
 * Un reloj que no retrocede, para medir cuánto pasó entre dos chunks.
 *
 * Avanza lo que más haya avanzado entre el reloj de pared y el monotónico. El
 * de pared solo no sirve: se corrige solo (NTP; en la máquina donde se probó
 * esto retrocedía 2,4 s cada medio minuto) y cada retroceso se comía segundos
 * grabados. El monotónico solo tampoco: en Android puede no correr mientras el
 * teléfono duerme, y ese rato es justo el hueco que hay que contar. Arranca en
 * la hora de pared, así sus valores sirven para decir "entre las 10:12 y las
 * 10:20".
 */
export function crearReloj(pared: () => number = Date.now, monotonico: () => number = () => performance.now()) {
  let ultimaPared = pared();
  let ultimoMonotonico = monotonico();
  let t = ultimaPared;
  return () => {
    const p = pared();
    const m = monotonico();
    t += Math.max(0, p - ultimaPared, m - ultimoMonotonico);
    ultimaPared = p;
    ultimoMonotonico = m;
    return t;
  };
}

/** Tramo de reloj en el que no llegó audio. Epoch ms. */
export interface Hueco {
  desde: number;
  hasta: number;
}

export interface Medida {
  /** Segundos de audio recibido. Es LA duración de la grabación. */
  segundos: number;
  chunks: number;
  bytes: number;
  /** Cuándo llegó el último chunk (o cuándo arrancó/reanudó la captura). */
  ultimoChunkEn: number;
  /** Hasta qué hora de reloj el audio recibido ya explica el tiempo pasado. */
  cubiertoHasta: number;
  huecos: Hueco[];
}

export function medidaInicial(ahora: number, segundosBase = 0): Medida {
  return { segundos: segundosBase, chunks: 0, bytes: 0, ultimoChunkEn: ahora, cubiertoHasta: ahora, huecos: [] };
}

/**
 * Suma un chunk a la medida.
 *
 * Mientras los chunks llegan seguidos, cada uno vale el tiempo que pasó desde
 * el anterior. Cuando hay reloj sin explicar (la página no corrió un rato), lo
 * que llega después se acredita por su TAMAÑO, comparado con el chunk
 * promedio, y nunca más que el reloj disponible: así un chunk enorme o una
 * ráfaga de chunks atrasados cuentan el audio que el navegador siguió
 * capturando, y un chunk normal después de veinte minutos cuenta un segundo.
 *
 * El hueco se declara recién cuando el audio vuelve a llegar a ritmo normal y
 * sigue habiendo reloj sin explicar: eso, y sólo eso, es tiempo sin audio.
 */
export function contarChunk(medida: Medida, bytes: number, ahora: number): Medida {
  const espera = Math.max(0, ahora - medida.ultimoChunkEn);
  const disponible = Math.max(0, ahora - medida.cubiertoHasta);
  const promedio = medida.chunks > 0 ? medida.bytes / medida.chunks : bytes;
  const porTamano = promedio > 0 ? (bytes / promedio) * TIMESLICE_MS : TIMESLICE_MS;
  const acreditado = disponible <= HUECO_MS ? disponible : Math.min(disponible, porTamano);
  const cubierto = medida.cubiertoHasta + acreditado;
  // Este chunk llegó a ritmo normal, ya se le acreditó todo lo que trae, y aun
  // así queda reloj sin explicar: ese tramo no tiene audio.
  const hayHueco = ahora - cubierto > HUECO_MS && espera >= RAFAGA_MS && espera <= HUECO_MS;

  return {
    segundos: medida.segundos + acreditado / 1000,
    chunks: medida.chunks + 1,
    bytes: medida.bytes + bytes,
    ultimoChunkEn: ahora,
    cubiertoHasta: hayHueco ? ahora : cubierto,
    huecos: hayHueco ? [...medida.huecos, { desde: cubierto, hasta: ahora }] : medida.huecos,
  };
}

/** Tras una pausa manual: el tiempo en pausa no es un hueco. */
export function reanudarMedida(medida: Medida, ahora: number): Medida {
  return { ...medida, ultimoChunkEn: ahora, cubiertoHasta: ahora };
}

/** Desde cuándo no llega audio, si ya pasó el umbral; null si está llegando. */
export function sinChunksDesde(medida: Medida, ahora: number): number | null {
  return ahora - medida.ultimoChunkEn > HUECO_MS ? medida.ultimoChunkEn : null;
}

export type EstadoLimite = "ok" | "aviso" | "limite";

export function estadoLimite(segundosGrabados: number): EstadoLimite {
  if (segundosGrabados >= LIMITE_SEGUNDOS) return "limite";
  if (segundosGrabados >= AVISO_LIMITE_SEGUNDOS) return "aviso";
  return "ok";
}

// La clave con que se guarda una grabación en el teléfono (IndexedDB).
//
// Arrancar a grabar no depende del servidor: con turno, la clave es su id;
// sin turno (Grabar desde la ficha), es una clave inventada en el teléfono
// que lleva la paciente y el instante en que empezó. El turno se crea recién
// al subir, con esa fecha: aunque la subida se reintente otro día o después
// de cerrar el navegador, el turno es el de la hora en que se grabó.

const PREFIJO = "sin-turno:";

/** `sin-turno:<pacienteId>:<ISO del inicio>` */
export function claveSinTurno(pacienteId: string, inicio: Date): string {
  return `${PREFIJO}${pacienteId}:${inicio.toISOString()}`;
}

export function esClaveSinTurno(clave: string): boolean {
  return clave.startsWith(PREFIJO);
}

/** ¿Es una grabación sin turno de esta paciente? */
export function esClaveSinTurnoDe(pacienteId: string, clave: string): boolean {
  return clave.startsWith(`${PREFIJO}${pacienteId}:`);
}

/** El instante de inicio que lleva la clave, o null si no es una clave sin
 *  turno o la fecha no se puede leer. */
export function inicioDeClaveSinTurno(clave: string): Date | null {
  if (!esClaveSinTurno(clave)) return null;
  const iso = clave.slice(clave.indexOf(":", PREFIJO.length) + 1);
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** El turno al que va una grabación guardada: el que se le anotó al subir o,
 *  si su clave es un turnoId, ese. Null: es sin turno y todavía no lo tiene. */
export function turnoDeLaGrabacion(clave: string, turnoAnotado: string | null): string | null {
  return turnoAnotado ?? (esClaveSinTurno(clave) ? null : clave);
}

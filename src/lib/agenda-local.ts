// ============================================
// Agenda local: los turnos de hoy y mañana guardados en el teléfono, para
// poder grabar cuando la app se abre sin señal (/sin-conexion).
//
// Qué guarda, y NADA más: turnoId, pacienteId, nombreParaMostrar, fecha
// ("AAAA-MM-DD" de Montevideo) y hora ("HH:MM" de Montevideo). Ni notas, ni
// transcripciones, ni teléfonos, ni el estado del cobro. `aRegistro` arma
// el registro campo por campo a propósito: si un llamador le pasa un turno
// entero, lo demás no entra.
//
// Se escribe cuando Hoy o una ficha se muestran con conexión; lo de hace más
// de dos días se purga en cada escritura y en cada lectura. Se BORRA ENTERA
// al cerrar sesión y al entrar (olvidarAgendaLocal): /sin-conexion es pública
// y el navegador puede ser compartido, así que los nombres de una cuenta no
// quedan a la vista de quien venga después, ni de otra cuenta que entre.
//
// Mismo patrón que grabacion-storage.ts: es un SEGURO, no una dependencia.
// Si IndexedDB no está o falla, no lanza: escribir no hace nada y leer
// devuelve vacío. La pantalla sin conexión dice entonces que no hay turnos
// guardados.
// ============================================

import { agregarDiasMvd, fechaInputMvd, formatearHoraMvd } from "@/lib/fechas-montevideo";

const DB_NOMBRE = "sesion-agenda-local";
const DB_VERSION = 1;
const STORE = "turnos";

/**
 * Marca de "sesión cerrada" en localStorage. Una escritura que todavía estaba
 * en vuelo al salir (la respuesta de Hoy o de una ficha que llega tarde, u
 * otra pestaña abierta) volvería a llenar la agenda después del borrado. La
 * marca la pone olvidarAgendaLocal ANTES de borrar y la saca el ingreso
 * (abrirAgendaLocal); cada escritura la mira DENTRO de su transacción. Las
 * transacciones de escritura sobre un mismo store corren en orden, así que
 * una escritura que corre después del borrado ve la marca y no guarda nada.
 * localStorage es compartido y síncrono entre pestañas.
 */
const MARCA_CERRADA = "sesion-agenda-local:cerrada";

function sesionCerrada(): boolean {
  try {
    return localStorage.getItem(MARCA_CERRADA) !== null;
  } catch {
    return false;
  }
}

function marcarCerrada(cerrada: boolean) {
  try {
    if (cerrada) localStorage.setItem(MARCA_CERRADA, "1");
    else localStorage.removeItem(MARCA_CERRADA);
  } catch {
    // Sin localStorage (modo privado estricto): queda el borrado solo.
  }
}

/** Lo de hace más de estos días se borra. */
const DIAS_DE_VIDA = 2;

export interface TurnoLocal {
  turnoId: string;
  pacienteId: string;
  nombreParaMostrar: string;
  /** "AAAA-MM-DD", día de Montevideo. */
  fecha: string;
  /** "HH:MM", hora de Montevideo. */
  hora: string;
}

/** Lo mínimo que hace falta de un turno para anotarlo. */
export interface TurnoParaAgenda {
  id: string;
  pacienteId: string;
  fecha: Date;
  nombreParaMostrar: string;
}

/** El registro, campo por campo: nada más entra en la agenda local. */
export function aRegistro(turno: TurnoParaAgenda): TurnoLocal {
  return {
    turnoId: turno.id,
    pacienteId: turno.pacienteId,
    nombreParaMostrar: turno.nombreParaMostrar,
    fecha: fechaInputMvd(turno.fecha),
    hora: formatearHoraMvd(turno.fecha),
  };
}

/** Hoy y mañana, en "AAAA-MM-DD" de Montevideo. */
export function diasQueSeGuardan(ahora: Date): [string, string] {
  return [fechaInputMvd(ahora), fechaInputMvd(agregarDiasMvd(ahora, 1))];
}

/** La fecha más vieja que se conserva: hace DIAS_DE_VIDA días. */
function fechaLimite(ahora: Date): string {
  return fechaInputMvd(agregarDiasMvd(ahora, -DIAS_DE_VIDA));
}

function indexedDBDisponible(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function abrirDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NOMBRE, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "turnoId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    request.onblocked = () => reject(new Error("Apertura de IndexedDB bloqueada"));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function esperarRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDBRequest falló"));
  });
}

function esperarTransaccion(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Transacción falló"));
    tx.onabort = () => reject(tx.error ?? new Error("Transacción abortada"));
  });
}

function avisar(operacion: string, error: unknown) {
  console.warn(`[agenda-local] ${operacion} falló`, error);
}

/**
 * Reemplaza en la agenda local los registros que `esDelAlcance` reconoce como
 * suyos por `nuevos`, y purga lo viejo. Un turno que se canceló o se movió
 * desaparece así de la agenda la próxima vez que se mira con señal.
 */
async function reemplazar(
  esDelAlcance: (registro: TurnoLocal) => boolean,
  nuevos: TurnoLocal[],
  ahora: Date,
): Promise<void> {
  if (!indexedDBDisponible()) return;
  const limite = fechaLimite(ahora);
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const actuales = await esperarRequest(store.getAll() as IDBRequest<TurnoLocal[]>);
    for (const registro of actuales ?? []) {
      if (registro.fecha < limite || esDelAlcance(registro)) store.delete(registro.turnoId);
    }
    // Después del getAll, ya dentro de la transacción: ver MARCA_CERRADA.
    if (!sesionCerrada()) for (const registro of nuevos) store.put(registro);
    await esperarTransaccion(tx);
  } catch (error) {
    avisar("escribir", error);
  }
}

/**
 * Lo que mostró Hoy con conexión: los turnos de ese día. Reemplaza todo el
 * día (lo que ya no está en la agenda se va). Sólo entran turnos de hoy: lo
 * que no reemplaza no lo escribe, así nada queda viejo sin que se lo pueda
 * borrar. Los de mañana los anota cada ficha.
 */
export function anotarAgendaDelDia(turnos: TurnoParaAgenda[], ahora: Date): Promise<void> {
  const [hoy] = diasQueSeGuardan(ahora);
  const nuevos = turnos.map(aRegistro).filter((t) => t.fecha === hoy);
  return reemplazar((r) => r.fecha === hoy, nuevos, ahora);
}

/**
 * Lo que mostró una ficha con conexión: los turnos de esa paciente. Reemplaza
 * los suyos de hoy y mañana.
 */
export function anotarTurnosDePaciente(
  pacienteId: string,
  turnos: TurnoParaAgenda[],
  ahora: Date,
): Promise<void> {
  const dias = diasQueSeGuardan(ahora);
  const nuevos = turnos
    .filter((t) => t.pacienteId === pacienteId)
    .map(aRegistro)
    .filter((t) => dias.includes(t.fecha));
  return reemplazar((r) => r.pacienteId === pacienteId && dias.includes(r.fecha), nuevos, ahora);
}

/** Todos los registros vigentes, por fecha y hora. Purga lo viejo. */
export async function leerAgendaLocal(ahora: Date): Promise<TurnoLocal[]> {
  if (!indexedDBDisponible()) return [];
  const limite = fechaLimite(ahora);
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const todos = (await esperarRequest(store.getAll() as IDBRequest<TurnoLocal[]>)) ?? [];
    const vigentes: TurnoLocal[] = [];
    for (const registro of todos) {
      if (registro.fecha < limite) store.delete(registro.turnoId);
      else vigentes.push(registro);
    }
    await esperarTransaccion(tx);
    return vigentes.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
  } catch (error) {
    avisar("leer", error);
    return [];
  }
}

/** Los turnos de hoy guardados en el teléfono. */
export async function turnosLocalesDeHoy(ahora: Date): Promise<TurnoLocal[]> {
  const [hoy] = diasQueSeGuardan(ahora);
  return (await leerAgendaLocal(ahora)).filter((t) => t.fecha === hoy);
}

/** Un turno guardado, o null. */
export async function buscarTurnoLocal(turnoId: string, ahora: Date): Promise<TurnoLocal | null> {
  return (await leerAgendaLocal(ahora)).find((t) => t.turnoId === turnoId) ?? null;
}

/** Borra toda la agenda local y no deja escribir más hasta el próximo
 *  ingreso (ver MARCA_CERRADA). Al cerrar sesión. Nunca lanza. */
export function olvidarAgendaLocal(): Promise<void> {
  marcarCerrada(true);
  return reemplazar(() => true, [], new Date());
}

/** Al entrar: borra lo que haya quedado de otra cuenta (o de una sesión que
 *  venció sin salir) y vuelve a dejar escribir. Nunca lanza. */
export async function abrirAgendaLocal(): Promise<void> {
  marcarCerrada(true);
  await reemplazar(() => true, [], new Date());
  marcarCerrada(false);
}

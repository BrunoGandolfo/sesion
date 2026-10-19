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
import { abridorDeBase, esperarRequest, esperarTransaccion, hayIndexedDB } from "@/lib/indexeddb";

const DB_NOMBRE = "sesion-agenda-local";
const DB_VERSION = 1;
const STORE = "turnos";

/**
 * Generación de la sesión, en localStorage (compartido y síncrono entre
 * pestañas). Una respuesta de Hoy o de una ficha que llega tarde —en esta u
 * otra pestaña, pedida con la cuenta anterior— no puede escribir la agenda
 * después de salir ni después de que entre otra cuenta (/sin-conexion es
 * pública). Por eso:
 *
 *   - quien pide los datos captura la generación ANTES de pedirlos
 *     (generacionAgenda) y la pasa al escribir;
 *   - salir (olvidarAgendaLocal) y entrar (abrirAgendaLocal) la cambian;
 *     salir la deja "cerrada" hasta el próximo ingreso;
 *   - cada escritura compara su generación con la vigente DENTRO de su
 *     transacción. Las transacciones de escritura sobre un mismo store corren
 *     en orden: una que corre después de un cambio de generación lo ve y no
 *     guarda nada.
 *
 * Sin localStorage (modo privado estricto) la generación es siempre la misma:
 * queda sólo el borrado al salir y al entrar.
 */
const CLAVE_GENERACION = "sesion-agenda-local:generacion";
const SIN_ALMACENAMIENTO = "sin-almacenamiento";
const CERRADA = ":cerrada";

/** La generación vigente. Capturarla antes de pedir los datos que se van a
 *  anotar. */
export function generacionAgenda(): string {
  try {
    return localStorage.getItem(CLAVE_GENERACION) ?? "0";
  } catch {
    return SIN_ALMACENAMIENTO;
  }
}

/** Pasa a una generación nueva, abierta o cerrada. */
function nuevaGeneracion(cerrada: boolean) {
  try {
    const actual = Number.parseInt(localStorage.getItem(CLAVE_GENERACION) ?? "0", 10);
    const siguiente = (Number.isFinite(actual) ? actual : 0) + 1;
    localStorage.setItem(CLAVE_GENERACION, `${siguiente}${cerrada ? CERRADA : ""}`);
  } catch {
    // Sin localStorage: queda el borrado solo.
  }
}

/** Si una escritura pedida en `generacion` todavía vale. */
function generacionVigente(generacion: string): boolean {
  return !generacion.endsWith(CERRADA) && generacion === generacionAgenda();
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

const abrirDB = abridorDeBase(DB_NOMBRE, DB_VERSION, (db) => {
  if (!db.objectStoreNames.contains(STORE)) {
    db.createObjectStore(STORE, { keyPath: "turnoId" });
  }
});

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
  generacion: string | null,
): Promise<void> {
  if (!hayIndexedDB()) return;
  const limite = fechaLimite(ahora);
  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const actuales = await esperarRequest(store.getAll() as IDBRequest<TurnoLocal[]>);
    // Ya dentro de la transacción: ver CLAVE_GENERACION. Una escritura de una
    // sesión anterior no borra ni escribe nada; un borrado (generacion null)
    // siempre se aplica.
    if (generacion !== null && !generacionVigente(generacion)) {
      tx.abort();
    } else {
      for (const registro of actuales ?? []) {
        if (registro.fecha < limite || esDelAlcance(registro)) store.delete(registro.turnoId);
      }
      for (const registro of nuevos) store.put(registro);
    }
    await esperarTransaccion(tx).catch((error) => {
      if (generacion !== null && !generacionVigente(generacion)) return;
      throw error;
    });
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
export function anotarAgendaDelDia(
  turnos: TurnoParaAgenda[],
  ahora: Date,
  generacion: string,
): Promise<void> {
  const [hoy] = diasQueSeGuardan(ahora);
  const nuevos = turnos.map(aRegistro).filter((t) => t.fecha === hoy);
  return reemplazar((r) => r.fecha === hoy, nuevos, ahora, generacion);
}

/**
 * Lo que mostró una ficha con conexión: los turnos de esa paciente. Reemplaza
 * los suyos de hoy y mañana.
 */
export function anotarTurnosDePaciente(
  pacienteId: string,
  turnos: TurnoParaAgenda[],
  ahora: Date,
  generacion: string,
): Promise<void> {
  const dias = diasQueSeGuardan(ahora);
  const nuevos = turnos
    .filter((t) => t.pacienteId === pacienteId)
    .map(aRegistro)
    .filter((t) => dias.includes(t.fecha));
  return reemplazar((r) => r.pacienteId === pacienteId && dias.includes(r.fecha), nuevos, ahora, generacion);
}

/** Todos los registros vigentes, por fecha y hora. Purga lo viejo. */
export async function leerAgendaLocal(ahora: Date): Promise<TurnoLocal[]> {
  if (!hayIndexedDB()) return [];
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
 *  ingreso (ver CLAVE_GENERACION). Al cerrar sesión. Nunca lanza. */
export function olvidarAgendaLocal(): Promise<void> {
  nuevaGeneracion(true);
  return reemplazar(() => true, [], new Date(), null);
}

/** Al entrar: borra lo que haya quedado de otra cuenta (o de una sesión que
 *  venció sin salir) y abre una generación nueva: lo que se haya pedido antes,
 *  en cualquier pestaña, ya no se escribe. Nunca lanza. */
export async function abrirAgendaLocal(): Promise<void> {
  nuevaGeneracion(true);
  await reemplazar(() => true, [], new Date(), null);
  nuevaGeneracion(false);
}

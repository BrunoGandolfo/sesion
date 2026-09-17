import type { DescriptorSegmento, PausaAudio } from "./contrato";

export interface GrabacionLocal {
  cuenta: string;
  organizationId: string;
  sesionId: string;
  turnoId: string;
  estado: "pausada" | "capturando" | "interrumpida" | "cerrada" | "entregada";
  cantidad: number;
  duracionMs: number;
  pausas: PausaAudio[];
}
export interface SegmentoLocal extends DescriptorSegmento {
  cuenta: string;
  sesionId: string;
  cifrado: ArrayBuffer;
}

export interface RespaldoLocal extends SegmentoLocal {
  /** Tiempo nuevo cubierto por el prefijo; el solape no se vuelve a sumar. */
  duracionMs: number;
}

function pedir<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function terminar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { tx.abort(); } catch { /* Ya terminó. */ }
      reject(new Error("El almacenamiento no respondió. Mantené esta página abierta y reintentá."));
    }, 10_000);
    tx.oncomplete = () => { clearTimeout(timeout); resolve(); };
    tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(tx.error ?? new Error("No se pudo guardar el audio cifrado")); };
  });
}

export async function abrirAlmacen(): Promise<IDBDatabase> {
  const r = indexedDB.open("sesion-audio-cifrado", 2);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains("grabaciones")) r.result.createObjectStore("grabaciones", { keyPath: ["cuenta", "sesionId"] }).createIndex("turno", ["cuenta", "turnoId"], { unique: true });
    if (!r.result.objectStoreNames.contains("segmentos")) r.result.createObjectStore("segmentos", { keyPath: ["cuenta", "sesionId", "indice"] });
    if (!r.result.objectStoreNames.contains("respaldos")) r.result.createObjectStore("respaldos", { keyPath: ["cuenta", "sesionId"] });
  };
  const db = await pedir(r);
  db.onversionchange = () => db.close();
  return db;
}

export async function buscarGrabacion(db: IDBDatabase, cuenta: string, turnoId: string): Promise<GrabacionLocal | undefined> {
  return pedir(db.transaction("grabaciones").objectStore("grabaciones").index("turno").get([cuenta, turnoId]));
}

export async function guardarGrabacion(db: IDBDatabase, grabacion: GrabacionLocal, nueva = false): Promise<void> {
  const tx = db.transaction("grabaciones", "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  const store = tx.objectStore("grabaciones");
  if (nueva) store.add(grabacion); else store.put(grabacion);
  await fin;
}

/** Segmento y reloj durable avanzan juntos o no avanza ninguno. */
export async function guardarSegmento(db: IDBDatabase, grabacion: GrabacionLocal, segmento: SegmentoLocal): Promise<void> {
  const tx = db.transaction(["grabaciones", "segmentos", "respaldos"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  tx.objectStore("segmentos").add(segmento);
  tx.objectStore("respaldos").delete([segmento.cuenta, segmento.sesionId]);
  tx.objectStore("grabaciones").put(grabacion);
  await fin;
}

export async function leerSegmento(db: IDBDatabase, cuenta: string, sesionId: string, indice: number): Promise<SegmentoLocal | undefined> {
  return pedir(db.transaction("segmentos").objectStore("segmentos").get([cuenta, sesionId, indice]));
}

/** Prefijo acumulado cifrado con el mismo formato del segmento. Nunca es
 * visible para la subida hasta que stop lo consolide o una reapertura lo recupere. */
export async function guardarRespaldo(db: IDBDatabase, respaldo: RespaldoLocal): Promise<void> {
  const tx = db.transaction(["grabaciones", "respaldos"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  const r = tx.objectStore("grabaciones").get([respaldo.cuenta, respaldo.sesionId]);
  r.onsuccess = () => {
    const g: GrabacionLocal | undefined = r.result;
    if (g && g.cantidad === respaldo.indice && !["cerrada", "entregada"].includes(g.estado)) tx.objectStore("respaldos").put(respaldo);
  };
  await fin;
}

/** Atómico e idempotente: al volver de una muerte del proceso, conserva el
 * prefijo ya cifrado sin pedir una clave ni descifrarlo en el dispositivo. */
export async function recuperarRespaldo(db: IDBDatabase, grabacion: GrabacionLocal): Promise<GrabacionLocal> {
  const tx = db.transaction(["grabaciones", "segmentos", "respaldos"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  let recuperada = grabacion;
  const r = tx.objectStore("respaldos").get([grabacion.cuenta, grabacion.sesionId]);
  r.onsuccess = () => {
    const respaldo: RespaldoLocal | undefined = r.result;
    if (!respaldo) return;
    if (respaldo.indice === grabacion.cantidad && !["cerrada", "entregada"].includes(grabacion.estado)) {
      const { duracionMs, ...segmento } = respaldo;
      recuperada = { ...grabacion, cantidad: grabacion.cantidad + 1, duracionMs: grabacion.duracionMs + duracionMs };
      tx.objectStore("segmentos").add(segmento);
      tx.objectStore("grabaciones").put(recuperada);
    }
    tx.objectStore("respaldos").delete([grabacion.cuenta, grabacion.sesionId]);
  };
  await fin;
  return recuperada;
}

/** Solo la base vieja de pruebas, explícitamente descartada por el dueño.
 * Nunca borra la base cifrada ni migra sus bytes. */
export async function retirarCopiasViejas(): Promise<boolean> {
  if (indexedDB.databases && !(await indexedDB.databases()).some(d => d.name === "sesion-grabaciones")) return false;
  const r = indexedDB.open("sesion-grabaciones");
  const db = await pedir(r);
  const cantidad = db.objectStoreNames.contains("chunks") ? await pedir(db.transaction("chunks").objectStore("chunks").count()) : 0;
  db.close();
  await new Promise<void>((resolve, reject) => {
    const borrar = indexedDB.deleteDatabase("sesion-grabaciones");
    borrar.onsuccess = () => resolve();
    borrar.onerror = () => reject(borrar.error);
    borrar.onblocked = () => reject(new Error("Cerrá la pestaña del grabador anterior para retirar sus copias sin cifrar"));
  });
  return cantidad > 0;
}

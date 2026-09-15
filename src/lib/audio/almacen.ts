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

function pedir<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function terminar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar el audio cifrado")); });
}

export async function abrirAlmacen(): Promise<IDBDatabase> {
  const r = indexedDB.open("sesion-audio-cifrado", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("grabaciones", { keyPath: ["cuenta", "sesionId"] }).createIndex("turno", ["cuenta", "turnoId"], { unique: true });
    r.result.createObjectStore("segmentos", { keyPath: ["cuenta", "sesionId", "indice"] });
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
  const tx = db.transaction(["grabaciones", "segmentos"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  tx.objectStore("segmentos").add(segmento);
  tx.objectStore("grabaciones").put(grabacion);
  await fin;
}

export async function leerSegmento(db: IDBDatabase, cuenta: string, sesionId: string, indice: number): Promise<SegmentoLocal | undefined> {
  return pedir(db.transaction("segmentos").objectStore("segmentos").get([cuenta, sesionId, indice]));
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

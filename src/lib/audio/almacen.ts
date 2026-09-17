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

/**
 * Una entrega de un segundo, cifrada con el índice de pieza que le tocaría si
 * hubiera que recuperarla. Escritura lineal: cada trozo se cifra y se escribe
 * una sola vez, y el cierre de la pieza las retira todas juntas.
 */
export interface EntregaLocal extends SegmentoLocal {
  /** Índice de la pieza en curso; `indice` es `base + orden`. */
  base: number;
  /** Tiempo nuevo que cubre esta entrega. */
  duracionMs: number;
}

/** Prefijo acumulado del grabador anterior (base v2). Sólo se lee, para no
 *  perder el audio de una grabación que quedó abierta en aquella versión. */
export interface RespaldoLocal extends SegmentoLocal {
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

/** Todas las entregas de una grabación, en orden de índice. */
function rangoEntregas(cuenta: string, sesionId: string): IDBKeyRange {
  return IDBKeyRange.bound([cuenta, sesionId], [cuenta, sesionId, []]);
}

export async function abrirAlmacen(): Promise<IDBDatabase> {
  const r = indexedDB.open("sesion-audio-cifrado", 3);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains("grabaciones")) r.result.createObjectStore("grabaciones", { keyPath: ["cuenta", "sesionId"] }).createIndex("turno", ["cuenta", "turnoId"], { unique: true });
    if (!r.result.objectStoreNames.contains("segmentos")) r.result.createObjectStore("segmentos", { keyPath: ["cuenta", "sesionId", "indice"] });
    if (!r.result.objectStoreNames.contains("entregas")) r.result.createObjectStore("entregas", { keyPath: ["cuenta", "sesionId", "indice"] });
    // `respaldos` (v2) se conserva vacío: lo lee una sola vez `recuperarEntregas`.
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

/** Pieza cerrada, reloj durable y retirada de sus entregas: todo junto o nada. */
export async function guardarSegmento(db: IDBDatabase, grabacion: GrabacionLocal, segmento: SegmentoLocal): Promise<void> {
  const tx = db.transaction(["grabaciones", "segmentos", "entregas"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  tx.objectStore("segmentos").add(segmento);
  tx.objectStore("entregas").delete(rangoEntregas(segmento.cuenta, segmento.sesionId));
  tx.objectStore("grabaciones").put(grabacion);
  await fin;
}

export async function leerSegmento(db: IDBDatabase, cuenta: string, sesionId: string, indice: number): Promise<SegmentoLocal | undefined> {
  return pedir(db.transaction("segmentos").objectStore("segmentos").get([cuenta, sesionId, indice]));
}

/** Una entrega sólo se guarda si la pieza que la espera sigue siendo la que
 *  el reloj durable señala. Una entrega tardía de una pieza ya cerrada no
 *  puede reaparecer. */
export async function guardarEntrega(db: IDBDatabase, entrega: EntregaLocal): Promise<void> {
  const tx = db.transaction(["grabaciones", "entregas"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  const r = tx.objectStore("grabaciones").get([entrega.cuenta, entrega.sesionId]);
  r.onsuccess = () => {
    const g: GrabacionLocal | undefined = r.result;
    if (g && g.cantidad === entrega.base && !["cerrada", "entregada"].includes(g.estado)) tx.objectStore("entregas").put(entrega);
  };
  await fin;
}

/**
 * Atómico e idempotente. Al volver de una muerte del proceso, las entregas de
 * la pieza que quedó sin cerrar se incorporan como piezas propias, de un
 * segundo cada una: ya están cifradas con el índice que les toca, así que no
 * hace falta ni la clave ni la red ni descifrar nada en el dispositivo.
 *
 * El worker las vuelve a pegar porque son continuación de la misma corrida.
 */
export async function recuperarEntregas(db: IDBDatabase, grabacion: GrabacionLocal): Promise<GrabacionLocal> {
  const tx = db.transaction(["grabaciones", "segmentos", "entregas", "respaldos"], "readwrite", { durability: "strict" });
  const fin = terminar(tx);
  const { cuenta, sesionId } = grabacion;
  const abierta = !["cerrada", "entregada"].includes(grabacion.estado);
  let recuperada = grabacion;
  const incorporar = (pieza: SegmentoLocal, duracionMs: number) => {
    const segmento: SegmentoLocal = {
      cuenta, sesionId, cifrado: pieza.cifrado, indice: pieza.indice, iv: pieza.iv,
      bytes: pieza.bytes, sha256: pieza.sha256, inicioMs: pieza.inicioMs, continuacion: pieza.continuacion,
    };
    tx.objectStore("segmentos").add(segmento);
    recuperada = { ...recuperada, cantidad: recuperada.cantidad + 1, duracionMs: recuperada.duracionMs + duracionMs };
    tx.objectStore("grabaciones").put(recuperada);
  };
  // Un prefijo dejado por la base v2: era un archivo completo del grabador
  // anterior, así que entra como pieza que se decodifica sola.
  const viejo = tx.objectStore("respaldos").get([cuenta, sesionId]);
  viejo.onsuccess = () => {
    const respaldo: RespaldoLocal | undefined = viejo.result;
    if (respaldo && abierta && respaldo.indice === recuperada.cantidad) incorporar({ ...respaldo, continuacion: false }, respaldo.duracionMs);
    if (respaldo) tx.objectStore("respaldos").delete([cuenta, sesionId]);
  };
  const pendientes = tx.objectStore("entregas").getAll(rangoEntregas(cuenta, sesionId));
  pendientes.onsuccess = () => {
    const entregas: EntregaLocal[] = [...(pendientes.result ?? [])].sort((a, b) => a.indice - b.indice);
    if (abierta) for (const entrega of entregas) {
      if (entrega.indice !== recuperada.cantidad) break;
      incorporar(entrega, entrega.duracionMs);
    }
    if (entregas.length) tx.objectStore("entregas").delete(rangoEntregas(cuenta, sesionId));
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

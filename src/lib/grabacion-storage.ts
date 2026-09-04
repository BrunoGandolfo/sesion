// ============================================
// Persistencia incremental de grabaciones en IndexedDB.
//
// Módulo de infraestructura puro: cero React, cero UI.
// Guarda los chunks de audio de una grabación en curso para poder
// recuperarlos si el navegador mata el proceso (MIUI, Chrome en
// Android, cierre de pestaña, etc.).
//
// Filosofía de errores: este módulo es un SEGURO, no una dependencia.
// Si IndexedDB no está disponible, la cuota se agota o cualquier
// operación falla, se degrada silenciosamente a solo-RAM (el
// comportamiento previo). Nunca lanza: una falla del backup jamás
// debe romper la grabación en curso.
//
// Nota de integración: el parámetro `sesionClinicaId` es el
// identificador con el que el caller nombra la grabación. En la
// integración actual GrabadorSesion usa el turnoId (relación 1:1
// turno ↔ sesión clínica), porque el componente no recibe el id de
// la sesión clínica como prop.
// ============================================

const DB_NOMBRE = "sesion-grabaciones";
const DB_VERSION = 1;
const STORE_CHUNKS = "chunks";
const STORE_META = "meta";

/** Duración del timeslice del MediaRecorder (ms). Cada chunk ≈ 1 segundo.
 *  Durante una pausa el MediaRecorder no emite chunks, así que contar chunks
 *  ya descuenta las pausas: la duración aproximada de una grabación
 *  recuperada no necesita corregirse con `pausas`. */
const SEGUNDOS_POR_CHUNK = 1;

/**
 * Tramo en el que la grabación estuvo detenida sin cerrarse: la terapeuta
 * tocó "Pausar" (MediaRecorder.pause()) o el micrófono se interrumpió.
 * Epoch en milisegundos. `fin` es null mientras la pausa sigue abierta.
 *
 * Vive acá y no en el componente porque es dato de la grabación, no de la
 * pantalla: si el navegador mata el proceso, las pausas se recuperan junto
 * con los chunks.
 */
export interface Pausa {
  inicio: number;
  fin: number | null;
}

interface MetaGrabacion {
  sesionClinicaId: string;
  iniciadaEn: number; // Date.now() al iniciar
  /** Ausente en grabaciones persistidas antes de que existiera la pausa. */
  pausas?: Pausa[];
}

interface ChunkGrabacion {
  sesionClinicaId: string;
  indice: number;
  chunk: Blob;
}

export interface GrabacionPendiente {
  sesionClinicaId: string;
  chunks: Blob[];
  duracionAproxSeg: number;
  pausas: Pausa[];
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
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NOMBRE, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, {
          keyPath: ["sesionClinicaId", "indice"],
        });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "sesionClinicaId" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // Si otra pestaña necesita actualizar la versión, soltamos la conexión.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    };

    request.onblocked = () => {
      reject(new Error("Apertura de IndexedDB bloqueada"));
    };
  });

  // Si la apertura falla, permitir reintentos futuros.
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

function rangoChunks(sesionClinicaId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [sesionClinicaId, 0],
    [sesionClinicaId, Number.MAX_SAFE_INTEGER],
  );
}

function avisar(operacion: string, error: unknown) {
  // Solo diagnóstico: la degradación es silenciosa para el usuario.
  console.warn(`[grabacion-storage] ${operacion} falló, sigo en solo-RAM`, error);
}

/**
 * Registra el inicio de una grabación. Borra cualquier chunk previo
 * asociado al mismo id (una grabación nueva reemplaza a la anterior
 * del mismo turno/sesión) y guarda el timestamp de inicio.
 */
export async function iniciarSesionGrabacion(
  sesionClinicaId: string,
): Promise<void> {
  if (!indexedDBDisponible()) {
    return;
  }

  try {
    const db = await abrirDB();
    const tx = db.transaction([STORE_CHUNKS, STORE_META], "readwrite");

    tx.objectStore(STORE_CHUNKS).delete(rangoChunks(sesionClinicaId));

    const meta: MetaGrabacion = {
      sesionClinicaId,
      iniciadaEn: Date.now(),
      pausas: [],
    };
    tx.objectStore(STORE_META).put(meta);

    await esperarTransaccion(tx);
  } catch (error) {
    avisar("iniciarSesionGrabacion", error);
  }
}

/**
 * Reemplaza la lista de pausas de una grabación en curso. Se llama al
 * pausar y al reanudar, fire-and-forget: igual que `guardarChunk`, nunca
 * lanza y jamás bloquea la grabación.
 *
 * Si la meta no existe (IndexedDB se vació entre medio) se recrea con
 * `iniciadaEn` de ahora: es preferible una meta con timestamp aproximado a
 * perder el registro de las pausas.
 */
export async function guardarPausas(
  sesionClinicaId: string,
  pausas: readonly Pausa[],
): Promise<void> {
  if (!indexedDBDisponible()) {
    return;
  }

  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    const actual = await esperarRequest(
      store.get(sesionClinicaId) as IDBRequest<MetaGrabacion | undefined>,
    );

    const meta: MetaGrabacion = {
      sesionClinicaId,
      iniciadaEn: actual?.iniciadaEn ?? Date.now(),
      pausas: pausas.map((p) => ({ inicio: p.inicio, fin: p.fin })),
    };
    store.put(meta);

    await esperarTransaccion(tx);
  } catch (error) {
    avisar("guardarPausas", error);
  }
}

/**
 * Persiste un chunk de audio. Pensado para llamarse fire-and-forget
 * desde `ondataavailable`: nunca lanza y no hay que await-earlo en el
 * hot path de la grabación.
 */
export async function guardarChunk(
  sesionClinicaId: string,
  indice: number,
  chunk: Blob,
): Promise<void> {
  if (!indexedDBDisponible()) {
    return;
  }

  try {
    const db = await abrirDB();
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const registro: ChunkGrabacion = { sesionClinicaId, indice, chunk };

    tx.objectStore(STORE_CHUNKS).put(registro);

    await esperarTransaccion(tx);
  } catch (error) {
    // Cuota agotada, DB cerrada, etc.: degradar a solo-RAM.
    avisar(`guardarChunk(${indice})`, error);
  }
}

/**
 * Devuelve la grabación pendiente más reciente (si existe alguna con
 * chunks persistidos), con sus chunks ordenados por índice.
 * Devuelve null si no hay nada recuperable o IndexedDB no está
 * disponible.
 */
export async function recuperarGrabacionPendiente(): Promise<GrabacionPendiente | null> {
  if (!indexedDBDisponible()) {
    return null;
  }

  try {
    const db = await abrirDB();

    const txMeta = db.transaction(STORE_META, "readonly");
    const metas = await esperarRequest(
      txMeta.objectStore(STORE_META).getAll() as IDBRequest<MetaGrabacion[]>,
    );

    if (!metas || metas.length === 0) {
      return null;
    }

    // Candidatas de la más reciente a la más vieja.
    const ordenadas = [...metas].sort((a, b) => b.iniciadaEn - a.iniciadaEn);

    for (const meta of ordenadas) {
      const txChunks = db.transaction(STORE_CHUNKS, "readonly");
      const registros = await esperarRequest(
        txChunks
          .objectStore(STORE_CHUNKS)
          .getAll(rangoChunks(meta.sesionClinicaId)) as IDBRequest<
          ChunkGrabacion[]
        >,
      );

      if (!registros || registros.length === 0) {
        continue;
      }

      registros.sort((a, b) => a.indice - b.indice);

      return {
        sesionClinicaId: meta.sesionClinicaId,
        chunks: registros.map((r) => r.chunk),
        duracionAproxSeg: registros.length * SEGUNDOS_POR_CHUNK,
        pausas: meta.pausas ?? [],
      };
    }

    return null;
  } catch (error) {
    avisar("recuperarGrabacionPendiente", error);
    return null;
  }
}

/**
 * Borra todos los chunks y la meta de una grabación. Llamar tras un
 * upload exitoso o un descarte explícito del usuario.
 */
export async function limpiarGrabacion(sesionClinicaId: string): Promise<void> {
  if (!indexedDBDisponible()) {
    return;
  }

  try {
    const db = await abrirDB();
    const tx = db.transaction([STORE_CHUNKS, STORE_META], "readwrite");

    tx.objectStore(STORE_CHUNKS).delete(rangoChunks(sesionClinicaId));
    tx.objectStore(STORE_META).delete(sesionClinicaId);

    await esperarTransaccion(tx);
  } catch (error) {
    avisar("limpiarGrabacion", error);
  }
}

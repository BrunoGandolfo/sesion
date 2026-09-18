// ============================================
// Persistencia incremental de grabaciones en IndexedDB.
//
// Módulo de infraestructura puro: cero React, cero UI.
// Guarda los chunks de audio de una grabación en curso para poder
// recuperarlos si el navegador mata el proceso (MIUI, Chrome en
// Android, cierre de pestaña, etc.).
//
// NADA SE ESCRIBE SIN CIFRAR. Cada chunk se cifra con la clave AES-256 de la
// sesión (la que entrega el servidor) y un IV propio de 12 bytes antes de
// entrar a IndexedDB: en el teléfono no queda audio en claro, ni un segundo.
// La clave no se guarda acá: para abrir una grabación recuperada se le pide
// al servidor de nuevo (POST [id]/clave) y se descifra con `descifrarChunks`.
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

/** Un trozo tal como queda en el teléfono: sólo bytes cifrados y su IV. */
export interface ChunkCifrado {
  /** 12 bytes aleatorios, en claro: no son secreto, y sin ellos no se abre. */
  iv: Uint8Array<ArrayBuffer>;
  /** AES-256-GCM del trozo (ciphertext + tag). */
  datos: ArrayBuffer;
}

interface ChunkGrabacion extends ChunkCifrado {
  sesionClinicaId: string;
  indice: number;
}

export interface GrabacionPendiente {
  sesionClinicaId: string;
  /** Cifrados: para volver a tener audio hace falta `descifrarChunks`. */
  chunks: ChunkCifrado[];
  duracionAproxSeg: number;
  pausas: Pausa[];
}

// ────────────────────────────────────────────────────────────────────────────
// Cifrado de cada trozo. Web Crypto, sin dependencias: la misma clave AES-GCM
// que cifra el archivo entero (src/lib/crypto.ts), pero sin pasar por base64,
// que sería un tercio más de bytes por cada segundo de audio.
// ────────────────────────────────────────────────────────────────────────────

const IV_BYTES = 12;

function claveABytes(claveBase64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(claveBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

function importarClave(claveBase64: string, uso: KeyUsage): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    claveABytes(claveBase64),
    { name: "AES-GCM" },
    false,
    [uso],
  );
}

async function cifrarChunk(chunk: Blob, claveBase64: string): Promise<ChunkCifrado> {
  const clave = await importarClave(claveBase64, "encrypt");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const datos = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    await chunk.arrayBuffer(),
  );
  return { iv, datos };
}

/**
 * Vuelve a tener los trozos en claro, en orden, con la clave de la sesión.
 * Lanza si la clave no es la de esa grabación: AES-GCM no abre con otra.
 */
export async function descifrarChunks(
  chunks: readonly ChunkCifrado[],
  claveBase64: string,
): Promise<Blob[]> {
  const clave = await importarClave(claveBase64, "decrypt");
  const abiertos: Blob[] = [];
  for (const chunk of chunks) {
    const datos = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: chunk.iv },
      clave,
      chunk.datos,
    );
    abiertos.push(new Blob([datos]));
  }
  return abiertos;
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
 * Cifra y persiste un chunk de audio. Pensado para llamarse fire-and-forget
 * desde `ondataavailable`: nunca lanza y no hay que await-earlo en el
 * hot path de la grabación. El chunk en claro no toca IndexedDB: se cifra
 * antes de abrir la transacción, y si el cifrado falla no se guarda nada.
 */
export async function guardarChunk(
  sesionClinicaId: string,
  indice: number,
  chunk: Blob,
  claveCifrado: string,
): Promise<void> {
  if (!indexedDBDisponible()) {
    return;
  }

  try {
    const cifrado = await cifrarChunk(chunk, claveCifrado);
    const db = await abrirDB();
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const registro: ChunkGrabacion = { sesionClinicaId, indice, ...cifrado };

    tx.objectStore(STORE_CHUNKS).put(registro);

    await esperarTransaccion(tx);
  } catch (error) {
    // Cuota agotada, DB cerrada, etc.: degradar a solo-RAM.
    avisar(`guardarChunk(${indice})`, error);
  }
}

/**
 * Devuelve la grabación pendiente más reciente (si existe alguna con
 * chunks persistidos), con sus chunks cifrados ordenados por índice.
 * Devuelve null si no hay nada recuperable o IndexedDB no está
 * disponible. Una grabación de la base anterior (chunks en claro, sin
 * `iv`) no se ofrece: no hay forma de tratarla como cifrada.
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

      if (registros.some((r) => !(r.iv instanceof Uint8Array) || !r.datos)) {
        continue;
      }

      return {
        sesionClinicaId: meta.sesionClinicaId,
        chunks: registros.map((r) => ({ iv: r.iv, datos: r.datos })),
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

// Lo mínimo de IndexedDB que comparten las dos copias que guarda el teléfono:
// la de la grabación (grabacion-storage.ts) y la agenda local
// (agenda-local.ts). Sólo abrir la base y esperar requests y transacciones;
// cada módulo decide sus stores y qué hacer cuando algo falla (los dos son
// un seguro: nunca lanzan hacia afuera).

/** Si el navegador tiene IndexedDB. Leerlo puede lanzar (modo privado
 *  estricto): eso es que no. */
export function hayIndexedDB(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Devuelve cómo abrir la base `nombre`: una sola vez, y la conexión se reusa.
 * Si otra pestaña necesita subir la versión, se suelta y la próxima vez se
 * abre de nuevo. Si la apertura falla, se puede reintentar.
 */
export function abridorDeBase(
  nombre: string,
  version: number,
  alActualizar: (db: IDBDatabase) => void,
): () => Promise<IDBDatabase> {
  let abierta: Promise<IDBDatabase> | null = null;

  return function abrir() {
    if (abierta) return abierta;

    const pedida = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(nombre, version);
      request.onupgradeneeded = () => alActualizar(request.result);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          abierta = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
      request.onblocked = () => reject(new Error("Apertura de IndexedDB bloqueada"));
    });
    abierta = pedida;
    pedida.catch(() => {
      if (abierta === pedida) abierta = null;
    });
    return pedida;
  };
}

export function esperarRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDBRequest falló"));
  });
}

export function esperarTransaccion(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Transacción falló"));
    tx.onabort = () => reject(tx.error ?? new Error("Transacción abortada"));
  });
}

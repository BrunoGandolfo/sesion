// Lo mínimo de IndexedDB que comparten la copia de la grabación
// (grabacion-storage.ts) y la agenda local (agenda-local.ts): abrir una vez,
// soltar la conexión si otra pestaña sube la versión, poder reintentar si la
// apertura falla, y las promesas de request y transacción. Lo que cada uno
// guarda se prueba en su propia suite.

import { afterEach, describe, expect, it, vi } from "vitest";

import { abridorDeBase, esperarRequest, esperarTransaccion, hayIndexedDB } from "@/lib/indexeddb";

type Pedido = {
  result: unknown;
  error: unknown;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
};

/** Un indexedDB.open que contesta lo que el test le diga. */
function indexedDBQue(contesta: (pedido: Pedido) => void) {
  const open = vi.fn<(nombre: string, version: number) => Pedido>(() => {
    const pedido: Pedido = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    queueMicrotask(() => contesta(pedido));
    return pedido;
  });
  vi.stubGlobal("indexedDB", { open });
  return open;
}

function baseFalsa() {
  return { onversionchange: null as (() => void) | null, close: vi.fn(), objectStoreNames: { contains: () => false } };
}

afterEach(() => vi.unstubAllGlobals());

describe("abridorDeBase", () => {
  it("abre una sola vez y reusa la conexión", async () => {
    const db = baseFalsa();
    const open = indexedDBQue((p) => { p.result = db; p.onsuccess?.(); });
    const abrir = abridorDeBase("una", 1, () => {});

    await expect(abrir()).resolves.toBe(db);
    await expect(abrir()).resolves.toBe(db);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("una", 1);
  });

  it("crea los stores en la primera apertura", async () => {
    const db = baseFalsa();
    indexedDBQue((p) => { p.result = db; p.onupgradeneeded?.(); p.onsuccess?.(); });
    const alActualizar = vi.fn();

    await abridorDeBase("una", 1, alActualizar)();
    expect(alActualizar).toHaveBeenCalledWith(db);
  });

  it("si otra pestaña sube la versión, suelta la conexión y la próxima vez abre de nuevo", async () => {
    const db = baseFalsa();
    const open = indexedDBQue((p) => { p.result = db; p.onsuccess?.(); });
    const abrir = abridorDeBase("una", 1, () => {});

    await abrir();
    db.onversionchange?.();
    expect(db.close).toHaveBeenCalled();
    await abrir();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["falla", (p: Pedido) => { p.error = new DOMException("x", "UnknownError"); p.onerror?.(); }],
    ["queda bloqueada", (p: Pedido) => { p.onblocked?.(); }],
  ])("si la apertura %s, rechaza y deja reintentar", async (_caso, fallar) => {
    const db = baseFalsa();
    let intentos = 0;
    const open = indexedDBQue((p) => {
      intentos += 1;
      if (intentos === 1) fallar(p);
      else { p.result = db; p.onsuccess?.(); }
    });
    const abrir = abridorDeBase("una", 1, () => {});

    await expect(abrir()).rejects.toBeDefined();
    await expect(abrir()).resolves.toBe(db);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("cada base tiene su propia conexión", async () => {
    const open = indexedDBQue((p) => { p.result = baseFalsa(); p.onsuccess?.(); });
    await abridorDeBase("una", 1, () => {})();
    await abridorDeBase("otra", 1, () => {})();
    expect(open.mock.calls.map(([nombre]) => nombre)).toEqual(["una", "otra"]);
  });
});

describe("esperarRequest y esperarTransaccion", () => {
  it("resuelven con el resultado y rechazan con el error", async () => {
    const ok = { result: 7, error: null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
    const promesa = esperarRequest(ok as unknown as IDBRequest<number>);
    ok.onsuccess?.();
    await expect(promesa).resolves.toBe(7);

    const tx = { error: new DOMException("x", "QuotaExceededError"), oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null };
    const abortada = esperarTransaccion(tx as unknown as IDBTransaction);
    tx.onabort?.();
    await expect(abortada).rejects.toBe(tx.error);
  });
});

describe("hayIndexedDB", () => {
  it("dice si está, y no lanza si leerlo lanza", () => {
    vi.stubGlobal("indexedDB", {});
    expect(hayIndexedDB()).toBe(true);
    vi.stubGlobal("indexedDB", undefined);
    expect(hayIndexedDB()).toBe(false);
  });
});

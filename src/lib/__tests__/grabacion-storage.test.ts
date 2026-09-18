// Tests del seguro de la grabación: lo que persiste en IndexedDB (chunks y
// pausas) para sobrevivir a que el navegador mate el proceso, y la promesa
// que el consentimiento hace sobre eso: en el teléfono no queda audio sin
// cifrar. El cifrado es Web Crypto de verdad (Node la trae), no un doble.
//
// La aritmética del cronómetro se mudó con su módulo:
// src/lib/__tests__/grabacion-cronometro.test.ts.
//
// El entorno de vitest es `node`, que no trae IndexedDB, y el proyecto no
// suma dependencias para esto: abajo hay un IndexedDB mínimo, suficiente
// para las cuatro operaciones que usa grabacion-storage (put, get, getAll y
// delete con y sin rango). Es un doble, no un polyfill: solo cubre lo que el
// módulo bajo prueba realmente llama.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// IndexedDB de juguete
// ────────────────────────────────────────────────────────────────────────────

type Clave = string | number | (string | number)[];

function comparar(a: Clave, b: Clave): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const largo = Math.min(a.length, b.length);

    for (let i = 0; i < largo; i += 1) {
      const orden = comparar(a[i], b[i]);
      if (orden !== 0) return orden;
    }

    return a.length - b.length;
  }

  // Claves simples: string contra string o número contra número. El doble
  // nunca mezcla tipos, así que alcanza con comparar directo.
  const x = a as unknown as number;
  const y = b as unknown as number;

  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

class RangoFalso {
  constructor(
    readonly lower: Clave,
    readonly upper: Clave,
  ) {}

  incluye(clave: Clave) {
    return comparar(clave, this.lower) >= 0 && comparar(clave, this.upper) <= 0;
  }

  static bound(lower: Clave, upper: Clave) {
    return new RangoFalso(lower, upper);
  }
}

interface PeticionFalsa<T> {
  result: T | undefined;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function peticion<T>(result: T | undefined): PeticionFalsa<T> {
  const req: PeticionFalsa<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  // Microtarea: igual que IndexedDB, la transacción sigue viva mientras el
  // consumidor encadena `await` sobre la petición.
  queueMicrotask(() => req.onsuccess?.());

  return req;
}

class StoreFalso {
  readonly registros = new Map<string, Record<string, unknown>>();

  constructor(readonly keyPath: string | string[]) {}

  private claveDe(valor: Record<string, unknown>): Clave {
    return Array.isArray(this.keyPath)
      ? (this.keyPath.map((p) => valor[p]) as Clave)
      : (valor[this.keyPath] as Clave);
  }

  put(valor: Record<string, unknown>) {
    this.registros.set(JSON.stringify(this.claveDe(valor)), valor);
    return peticion(undefined);
  }

  get(clave: Clave) {
    return peticion(this.registros.get(JSON.stringify(clave)));
  }

  getAll(rango?: RangoFalso) {
    const todos = [...this.registros.entries()]
      .map(([clave, valor]) => ({ clave: JSON.parse(clave) as Clave, valor }))
      .filter(({ clave }) => !rango || rango.incluye(clave))
      .sort((a, b) => comparar(a.clave, b.clave))
      .map(({ valor }) => valor);

    return peticion(todos);
  }

  delete(claveORango: Clave | RangoFalso) {
    for (const clave of [...this.registros.keys()]) {
      const decodificada = JSON.parse(clave) as Clave;
      const coincide =
        claveORango instanceof RangoFalso
          ? claveORango.incluye(decodificada)
          : comparar(decodificada, claveORango) === 0;

      if (coincide) {
        this.registros.delete(clave);
      }
    }

    return peticion(undefined);
  }
}

class TransaccionFalsa {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;

  constructor(private readonly stores: Map<string, StoreFalso>) {
    // Macrotarea: se completa después de que corrieron todas las microtareas
    // de las peticiones que la transacción encadenó.
    setTimeout(() => this.oncomplete?.(), 0);
  }

  objectStore(nombre: string) {
    const store = this.stores.get(nombre);
    if (!store) throw new Error(`store inexistente: ${nombre}`);
    return store;
  }
}

class DBFalsa {
  readonly stores = new Map<string, StoreFalso>();
  onversionchange: (() => void) | null = null;

  readonly objectStoreNames = {
    contains: (nombre: string) => this.stores.has(nombre),
  };

  createObjectStore(nombre: string, opciones: { keyPath: string | string[] }) {
    const store = new StoreFalso(opciones.keyPath);
    this.stores.set(nombre, store);
    return store;
  }

  transaction(nombres: string | string[]) {
    void nombres;
    return new TransaccionFalsa(this.stores);
  }

  close() {}

  vaciar() {
    for (const store of this.stores.values()) {
      store.registros.clear();
    }
  }
}

const dbFalsa = new DBFalsa();

const indexedDBFalso = {
  open: () => {
    const req = {
      result: dbFalsa,
      error: null as unknown,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };

    setTimeout(() => {
      if (dbFalsa.stores.size === 0) {
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    }, 0);

    return req;
  },
};

// ────────────────────────────────────────────────────────────────────────────

type ModuloStorage = typeof import("@/lib/grabacion-storage");

let storage!: ModuloStorage;

const TURNO = "turno_abc";
const OTRO_TURNO = "turno_xyz";
/** La clave AES de la sesión, base64, como la entrega el servidor. */
const CLAVE = Buffer.alloc(32, 7).toString("base64");
const OTRA_CLAVE = Buffer.alloc(32, 9).toString("base64");

function chunk(texto: string) {
  return new Blob([texto], { type: "audio/webm" });
}

/** Recupera exigiendo que haya algo: falla el test si no, y de paso estrecha
 *  el tipo para el resto de las aserciones. */
async function recuperarAlgo() {
  const pendiente = await storage.recuperarGrabacionPendiente();

  if (!pendiente) {
    throw new Error("Se esperaba una grabación pendiente y no hay ninguna");
  }

  return pendiente;
}

/** Los chunks recuperados, ya abiertos con la clave de la sesión. */
async function chunksAbiertos(clave = CLAVE) {
  const pendiente = await recuperarAlgo();
  return {
    ...pendiente,
    abiertos: await storage.descifrarChunks(pendiente.chunks, clave),
  };
}

beforeAll(async () => {
  vi.stubGlobal("indexedDB", indexedDBFalso);
  vi.stubGlobal("IDBKeyRange", RangoFalso);
  // La importación va después de los stubs: el módulo cachea la conexión.
  storage = await import("@/lib/grabacion-storage");
});

beforeEach(() => {
  dbFalsa.vaciar();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("indexedDB", indexedDBFalso);
  vi.stubGlobal("IDBKeyRange", RangoFalso);
});

describe("grabacion-storage — guardar y recuperar", () => {
  it("devuelve los chunks de la grabación en el orden en que se capturaron", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    // A propósito fuera de orden: la recuperación ordena por índice.
    await storage.guardarChunk(TURNO, 2, chunk("c"), CLAVE);
    await storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE);
    await storage.guardarChunk(TURNO, 1, chunk("b"), CLAVE);

    const pendiente = await chunksAbiertos();

    expect(pendiente.sesionClinicaId).toBe(TURNO);
    expect(pendiente.abiertos).toHaveLength(3);
    expect(await Promise.all(pendiente.abiertos.map((c) => c.text()))).toEqual([
      "a",
      "b",
      "c",
    ]);
    // Un chunk por segundo.
    expect(pendiente.duracionAproxSeg).toBe(3);
  });

  it("no devuelve nada cuando no hay ninguna grabación", async () => {
    await expect(storage.recuperarGrabacionPendiente()).resolves.toBeNull();
  });

  it("ignora una grabación cuya meta quedó sin chunks", async () => {
    await storage.iniciarSesionGrabacion(TURNO);

    await expect(storage.recuperarGrabacionPendiente()).resolves.toBeNull();
  });

  it("empezar de nuevo el mismo turno reemplaza los chunks anteriores", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("vieja"), CLAVE);

    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("nueva"), CLAVE);

    const pendiente = await chunksAbiertos();

    expect(pendiente.abiertos).toHaveLength(1);
    expect(await pendiente.abiertos[0].text()).toBe("nueva");
  });
});

describe("grabacion-storage — pausas", () => {
  it("guarda las pausas y las devuelve con la grabación recuperada", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE);
    await storage.guardarPausas(TURNO, [
      { inicio: 1_000, fin: 4_000 },
      { inicio: 9_000, fin: null },
    ]);

    const pendiente = await recuperarAlgo();

    expect(pendiente.pausas).toEqual([
      { inicio: 1_000, fin: 4_000 },
      { inicio: 9_000, fin: null },
    ]);
  });

  it("una grabación recién iniciada no tiene pausas", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE);

    const pendiente = await recuperarAlgo();

    expect(pendiente.pausas).toEqual([]);
  });

  it("guardar pausas no borra los chunks ya persistidos", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE);
    await storage.guardarPausas(TURNO, [{ inicio: 5, fin: 9 }]);
    await storage.guardarChunk(TURNO, 1, chunk("b"), CLAVE);

    const pendiente = await recuperarAlgo();

    expect(pendiente.chunks).toHaveLength(2);
    expect(pendiente.pausas).toEqual([{ inicio: 5, fin: 9 }]);
  });
});

describe("grabacion-storage — borrar", () => {
  it("limpiarGrabacion borra chunks y meta de esa grabación", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE);

    await storage.limpiarGrabacion(TURNO);

    await expect(storage.recuperarGrabacionPendiente()).resolves.toBeNull();
  });

  it("limpiarGrabacion no toca la grabación de otro turno", async () => {
    await storage.iniciarSesionGrabacion(OTRO_TURNO);
    await storage.guardarChunk(OTRO_TURNO, 0, chunk("otra"), CLAVE);
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk("esta"), CLAVE);

    await storage.limpiarGrabacion(TURNO);

    const pendiente = await recuperarAlgo();

    expect(pendiente.sesionClinicaId).toBe(OTRO_TURNO);
    const [abierto] = await storage.descifrarChunks(pendiente.chunks, CLAVE);
    expect(await abierto.text()).toBe("otra");
  });
});

describe("grabacion-storage — degradación", () => {
  it("sin IndexedDB no lanza y se comporta como solo-RAM", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(storage.iniciarSesionGrabacion(TURNO)).resolves.toBeUndefined();
    await expect(
      storage.guardarChunk(TURNO, 0, chunk("a"), CLAVE),
    ).resolves.toBeUndefined();
    await expect(storage.guardarPausas(TURNO, [])).resolves.toBeUndefined();
    await expect(storage.limpiarGrabacion(TURNO)).resolves.toBeUndefined();
    await expect(storage.recuperarGrabacionPendiente()).resolves.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La promesa del consentimiento: "En el teléfono no queda audio sin cifrar".
// Se mira lo que quedó escrito en el almacén, no lo que devuelve el módulo.
// ────────────────────────────────────────────────────────────────────────────

describe("grabacion-storage — nada queda en claro", () => {
  const MARCA = "dato clinico sensible que no puede quedar en el telefono";

  /** Todo lo que hay en el store de chunks, byte a byte, como texto. */
  function todoLoEscrito(): { registros: Record<string, unknown>[]; texto: string } {
    const store = dbFalsa.stores.get("chunks");
    if (!store) throw new Error("no hay store de chunks");
    const registros = [...store.registros.values()];
    const partes = registros.map((r) =>
      Object.values(r)
        .map((v) => {
          if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
          if (v instanceof Uint8Array) return new TextDecoder().decode(v);
          return String(v);
        })
        .join("|"),
    );
    return { registros, texto: partes.join("\n") };
  }

  it("cada chunk se escribe cifrado, con IV propio, y nunca como Blob", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk(MARCA), CLAVE);
    await storage.guardarChunk(TURNO, 1, chunk(MARCA), CLAVE);

    const { registros, texto } = todoLoEscrito();

    expect(registros).toHaveLength(2);
    expect(texto).not.toContain(MARCA);
    expect(texto).not.toContain("sensible");
    for (const r of registros) {
      expect(r.chunk).toBeUndefined();
      expect(Object.values(r).some((v) => v instanceof Blob)).toBe(false);
      expect(r.iv).toBeInstanceOf(Uint8Array);
      expect((r.iv as Uint8Array).byteLength).toBe(12);
      expect(r.datos).toBeInstanceOf(ArrayBuffer);
      // GCM agrega 16 bytes de tag: lo cifrado es más largo que el audio.
      expect((r.datos as ArrayBuffer).byteLength).toBe(MARCA.length + 16);
    }
    // Mismo audio dos veces, distinto cifrado: el IV cumple su función.
    const [a, b] = registros;
    expect(Buffer.from(a.iv as Uint8Array).equals(Buffer.from(b.iv as Uint8Array))).toBe(false);
    expect(Buffer.from(a.datos as ArrayBuffer).equals(Buffer.from(b.datos as ArrayBuffer))).toBe(false);
  });

  it("lo recuperado sigue cifrado y se abre sólo con la clave de la sesión", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    await storage.guardarChunk(TURNO, 0, chunk(MARCA), CLAVE);

    const pendiente = await recuperarAlgo();
    const crudo = new TextDecoder().decode(pendiente.chunks[0].datos);
    expect(crudo).not.toContain(MARCA);

    const [abierto] = await storage.descifrarChunks(pendiente.chunks, CLAVE);
    expect(await abierto.text()).toBe(MARCA);

    await expect(storage.descifrarChunks(pendiente.chunks, OTRA_CLAVE)).rejects.toBeTruthy();
  });

  it("una grabación de la base anterior, guardada en claro, no se ofrece", async () => {
    await storage.iniciarSesionGrabacion(TURNO);
    // Un registro como los escribía el grabador viejo: el Blob tal cual.
    dbFalsa.stores.get("chunks")!.put({ sesionClinicaId: TURNO, indice: 0, chunk: chunk("vieja") });

    await expect(storage.recuperarGrabacionPendiente()).resolves.toBeNull();
  });
});

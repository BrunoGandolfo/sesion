// La agenda local (src/lib/agenda-local.ts): qué guarda el teléfono para
// poder grabar cuando la app se abre sin señal. Debe quedar cierto que:
//   - sólo entran turnoId, pacienteId, nombreParaMostrar, fecha y hora;
//   - sólo de hoy y mañana (Montevideo);
//   - Hoy reemplaza el día entero y una ficha reemplaza los de su paciente;
//   - lo de hace más de dos días se purga;
//   - al salir y al entrar se borra entera, y una escritura pedida con una
//     sesión anterior (en esta u otra pestaña) no la vuelve a llenar;
//   - sin IndexedDB no lanza.
//
// vitest corre en `node`, sin IndexedDB: abajo hay uno mínimo para un único
// store con keyPath simple (put, delete, getAll). Es un doble, no un polyfill.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { instanteMvd } from "@/lib/fechas-montevideo";

function peticion<T>(result: T) {
  const req = { result, error: null, onsuccess: null as (() => void) | null, onerror: null };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

const registros = new Map<string, Record<string, unknown>>();

const storeFalso = {
  put: (valor: Record<string, unknown>) => {
    registros.set(String(valor.turnoId), structuredClone(valor));
    return peticion(undefined);
  },
  delete: (clave: string) => {
    registros.delete(clave);
    return peticion(undefined);
  },
  getAll: () => peticion([...registros.values()].map((v) => structuredClone(v))),
};

const dbFalsa = {
  onversionchange: null,
  objectStoreNames: { contains: () => true },
  createObjectStore: () => storeFalso,
  transaction: () => {
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null,
      onabort: null as (() => void) | null,
      error: null,
      abortada: false,
      objectStore: () => storeFalso,
      abort: () => {
        tx.abortada = true;
      },
    };
    setTimeout(() => (tx.abortada ? tx.onabort?.() : tx.oncomplete?.()), 0);
    return tx;
  },
  close: () => {},
};

const indexedDBFalso = {
  open: () => {
    const req = { result: dbFalsa, error: null, onupgradeneeded: null, onsuccess: null as (() => void) | null, onerror: null, onblocked: null };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
};

type Modulo = typeof import("@/lib/agenda-local");
let agenda!: Modulo;

// Martes 13 de octubre de 2026, 10:00 de Montevideo.
const AHORA = instanteMvd(2026, 9, 13, 10, 0);
const HOY_15 = instanteMvd(2026, 9, 13, 15, 0);
const HOY_9 = instanteMvd(2026, 9, 13, 9, 30);
const MANANA_11 = instanteMvd(2026, 9, 14, 11, 0);
const PASADO_11 = instanteMvd(2026, 9, 15, 11, 0);
// 23:30 de Montevideo es el día siguiente en UTC: tiene que quedar en el 13.
const HOY_NOCHE = instanteMvd(2026, 9, 13, 23, 30);

function turno(id: string, fecha: Date, pacienteId = "pac_1", nombre = "Ana Pérez") {
  return { id, pacienteId, fecha, nombreParaMostrar: nombre };
}

// localStorage de juguete: la marca de sesión cerrada (compartida entre pestañas).
const marca = new Map<string, string>();
const localStorageFalso = {
  getItem: (k: string) => marca.get(k) ?? null,
  setItem: (k: string, v: string) => void marca.set(k, v),
  removeItem: (k: string) => void marca.delete(k),
};

beforeAll(async () => {
  vi.stubGlobal("localStorage", localStorageFalso);
  vi.stubGlobal("indexedDB", indexedDBFalso);
  agenda = await import("@/lib/agenda-local");
});

beforeEach(() => {
  registros.clear();
  marca.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", localStorageFalso);
  vi.stubGlobal("indexedDB", indexedDBFalso);
});

describe("agenda local — qué se guarda", () => {
  it("sólo los cinco campos, aunque el llamador pase el turno entero", async () => {
    const entero = {
      ...turno("t1", HOY_15),
      notas: "nota privada",
      paciente: { telefono: "099 123 456" },
      sesionClinica: { id: "s1", estado: "aprobada" },
      tarifaCobrada: 2200,
    };
    await agenda.anotarAgendaDelDia([entero], AHORA, agenda.generacionAgenda());

    expect([...registros.values()]).toEqual([
      { turnoId: "t1", pacienteId: "pac_1", nombreParaMostrar: "Ana Pérez", fecha: "2026-10-13", hora: "15:00" },
    ]);
  });

  it("fecha y hora de Montevideo, también pasadas las 21 (otro día en UTC)", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_NOCHE)], AHORA, agenda.generacionAgenda());
    expect(registros.get("t1")).toMatchObject({ fecha: "2026-10-13", hora: "23:30" });
  });

  it("sólo hoy y mañana: pasado mañana no entra", async () => {
    await agenda.anotarTurnosDePaciente(
      "pac_1",
      [turno("t1", HOY_15), turno("t2", MANANA_11), turno("t3", PASADO_11)],
      AHORA,
      agenda.generacionAgenda(),
    );
    expect([...registros.keys()].sort()).toEqual(["t1", "t2"]);
  });

  it("Hoy anota sólo el día: uno de mañana no entra (no lo podría borrar si se cancela)", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15), turno("t2", MANANA_11)], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()]).toEqual(["t1"]);
  });

  it("una ficha no anota turnos de otra paciente", async () => {
    await agenda.anotarTurnosDePaciente("pac_1", [turno("t1", HOY_15), turno("t2", HOY_9, "pac_2")], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()]).toEqual(["t1"]);
  });
});

describe("agenda local — reemplazos", () => {
  it("Hoy reemplaza el día: un turno que ya no está (cancelado, movido) se va", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_9), turno("t2", HOY_15)], AHORA, agenda.generacionAgenda());
    await agenda.anotarAgendaDelDia([turno("t2", HOY_15)], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()]).toEqual(["t2"]);
  });

  it("Hoy no borra lo de mañana que anotó una ficha", async () => {
    await agenda.anotarTurnosDePaciente("pac_1", [turno("t2", MANANA_11)], AHORA, agenda.generacionAgenda());
    await agenda.anotarAgendaDelDia([turno("t1", HOY_9, "pac_3")], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()].sort()).toEqual(["t1", "t2"]);
  });

  it("una ficha reemplaza sólo los turnos de su paciente", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_9, "pac_1"), turno("t2", HOY_15, "pac_2")], AHORA, agenda.generacionAgenda());
    await agenda.anotarTurnosDePaciente("pac_1", [], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()]).toEqual(["t2"]);
  });
});

describe("agenda local — purga y lectura", () => {
  it("purga lo de hace más de dos días al escribir y al leer", async () => {
    registros.set("viejo", { turnoId: "viejo", pacienteId: "p", nombreParaMostrar: "X", fecha: "2026-10-10", hora: "10:00" });
    registros.set("anteayer", { turnoId: "anteayer", pacienteId: "p", nombreParaMostrar: "X", fecha: "2026-10-11", hora: "10:00" });
    await agenda.leerAgendaLocal(AHORA);
    expect([...registros.keys()]).toEqual(["anteayer"]);

    registros.set("viejo", { turnoId: "viejo", pacienteId: "p", nombreParaMostrar: "X", fecha: "2026-10-10", hora: "10:00" });
    await agenda.anotarAgendaDelDia([], AHORA, agenda.generacionAgenda());
    expect(registros.has("viejo")).toBe(false);
  });

  it("los de hoy, por hora", async () => {
    await agenda.anotarTurnosDePaciente("pac_1", [turno("t2", MANANA_11), turno("t1", HOY_15), turno("t0", HOY_9)], AHORA, agenda.generacionAgenda());
    const hoy = await agenda.turnosLocalesDeHoy(AHORA);
    expect(hoy.map((t) => t.turnoId)).toEqual(["t0", "t1"]);
  });

  it("busca un turno guardado por su id", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, agenda.generacionAgenda());
    expect(await agenda.buscarTurnoLocal("t1", AHORA)).toMatchObject({ nombreParaMostrar: "Ana Pérez", hora: "15:00" });
    expect(await agenda.buscarTurnoLocal("otro", AHORA)).toBeNull();
  });

  it("olvidarAgendaLocal borra todo, de cualquier día y paciente", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, agenda.generacionAgenda());
    await agenda.anotarTurnosDePaciente("pac_2", [turno("t2", MANANA_11, "pac_2")], AHORA, agenda.generacionAgenda());
    await agenda.olvidarAgendaLocal();
    expect(registros.size).toBe(0);
  });

  it("una escritura pedida antes de salir no vuelve a llenar la agenda, ni antes ni después del próximo ingreso", async () => {
    // La respuesta de Hoy que estaba en vuelo, u otra pestaña con la cuenta anterior.
    const vieja = agenda.generacionAgenda();
    await agenda.olvidarAgendaLocal();
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, vieja);
    expect(registros.size).toBe(0);
    // Pedida ya con la sesión cerrada, tampoco.
    await agenda.anotarTurnosDePaciente("pac_1", [turno("t2", MANANA_11)], AHORA, agenda.generacionAgenda());
    expect(registros.size).toBe(0);

    await agenda.abrirAgendaLocal();
    await agenda.anotarAgendaDelDia([turno("t3", HOY_9, "pac_3")], AHORA, agenda.generacionAgenda());
    // La de la cuenta anterior llega tarde, después del ingreso: no borra ni escribe.
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, vieja);
    expect([...registros.keys()]).toEqual(["t3"]);
  });

  it("una escritura pedida antes de que entre otra cuenta (sin salir) tampoco vale", async () => {
    const vieja = agenda.generacionAgenda();
    await agenda.abrirAgendaLocal();
    await agenda.anotarTurnosDePaciente("pac_1", [turno("t1", HOY_15)], AHORA, vieja);
    expect(registros.size).toBe(0);
  });

  it("entrar borra lo que quedó de otra cuenta", async () => {
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, agenda.generacionAgenda());
    await agenda.abrirAgendaLocal();
    expect(registros.size).toBe(0);
  });

  it("sin localStorage se sigue escribiendo (queda sólo el borrado al salir y al entrar)", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    await agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, agenda.generacionAgenda());
    expect([...registros.keys()]).toEqual(["t1"]);
    await agenda.olvidarAgendaLocal();
    expect(registros.size).toBe(0);
  });

  it("sin IndexedDB no lanza: escribir no hace nada y leer devuelve vacío", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(agenda.anotarAgendaDelDia([turno("t1", HOY_15)], AHORA, agenda.generacionAgenda())).resolves.toBeUndefined();
    expect(await agenda.leerAgendaLocal(AHORA)).toEqual([]);
    expect(registros.size).toBe(0);
  });
});

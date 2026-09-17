// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GrabacionLocal } from "@/lib/audio/almacen";
import { ErrorAudio } from "@/lib/audio/sincronizar";
import { Grabadora } from "@/lib/audio/grabadora";

const m = vi.hoisted(() => ({
  grabaciones: new Map<string, GrabacionLocal>(),
  guardar: vi.fn(), segmento: vi.fn(), pedir: vi.fn(), sincronizar: vi.fn(), cerrar: vi.fn(), recuperar: vi.fn(),
}));
vi.mock("@/lib/audio/almacen", () => ({
  abrirAlmacen: async () => ({ close: m.cerrar }),
  retirarCopiasViejas: async () => false,
  buscarGrabacion: async (_db: unknown, cuenta: string, turno: string) => [...m.grabaciones.values()].find(g => g.cuenta === cuenta && g.turnoId === turno),
  guardarGrabacion: m.guardar,
  guardarSegmento: m.segmento,
  guardarEntrega: vi.fn(), recuperarEntregas: m.recuperar,
}));
vi.mock("@/lib/audio/sincronizar", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/audio/sincronizar")>(),
  pedirAudio: m.pedir, sincronizarAudio: m.sincronizar,
}));
vi.mock("@/lib/audio/cifrado", () => ({ importarClave: async () => ({}), cifrarSegmento: vi.fn() }));
const abiertas: Grabadora[] = [];
const original = (): GrabacionLocal => ({ cuenta: "cuenta", organizationId: "org", turnoId: "turno", sesionId: "sesion-recuperada", estado: "entregada", cantidad: 3, duracionMs: 120_000, pausas: [] });
beforeEach(() => {
  vi.useFakeTimers();
  m.grabaciones.clear();
  vi.clearAllMocks();
  m.guardar.mockImplementation(async (_db, g: GrabacionLocal) => { m.grabaciones.set(g.sesionId, structuredClone(g)); });
  m.recuperar.mockImplementation(async (_db: unknown, g: GrabacionLocal) => g);
  m.pedir.mockRejectedValue(new ErrorAudio("Grabación no encontrada", 404));
  m.sincronizar.mockRejectedValue(new ErrorAudio("Grabación no encontrada", 404));
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
});
afterEach(async () => { await Promise.all(abiertas.splice(0).map(g => g.cerrar())); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function abrir(g = original()) {
  m.grabaciones.set(g.sesionId, structuredClone(g));
  const grabadora = new Grabadora("cuenta", "org", "turno");
  abiertas.push(grabadora);
  await grabadora.abrir();
  await grabadora.enviar();
  return grabadora;
}

test("recupera el identificador real y marca el tramo abierto como posiblemente incompleto", async () => {
  // Sin falla de red: así se ve el aviso de la reapertura, que una falla
  // posterior taparía (en pantalla hay una sola línea a la vez).
  m.sincronizar.mockResolvedValue({ estado: "grabando" });
  const grabadora = await abrir({ ...original(), estado: "capturando" });
  expect(grabadora.snapshot().grabacion).toMatchObject({ sesionId: "sesion-recuperada", estado: "interrumpida", cantidad: 3 });
  expect(grabadora.snapshot().mensaje).toContain("incompleto");
  expect(m.sincronizar.mock.calls[0][1].sesionId).toBe("sesion-recuperada");
  expect(m.grabaciones.get("sesion-recuperada")?.pausas).toEqual([{ inicio: 120_000, fin: null, siguienteIndice: 3, motivo: "interrupcion" }]);
});

test("un 404 comprobado permite otra grabación y conserva identidad, cantidad y duración de la anterior", async () => {
  const grabadora = await abrir();
  await grabadora.apartarCopia();
  expect(m.pedir).toHaveBeenCalledExactlyOnceWith("/sesion-recuperada");
  expect(m.grabaciones.get("sesion-recuperada")).toEqual({ ...original(), turnoId: "turno:archivo:sesion-recuperada" });
  expect(grabadora.snapshot().grabacion).toBeNull();
  expect(grabadora.snapshot().ocupada).toBe(false);
});

test("no archiva si al reconciliar la sesión vuelve a existir", async () => {
  const grabadora = await abrir();
  m.pedir.mockResolvedValueOnce({ estado: "procesando" });
  await grabadora.apartarCopia();
  expect(m.grabaciones.get("sesion-recuperada")).toEqual(original());
  expect(grabadora.snapshot().grabacion?.sesionId).toBe("sesion-recuperada");
  expect(grabadora.snapshot().desacuerdo).toBeNull();
});

test("perder la respuesta de la comprobación no habilita otra grabación", async () => {
  const grabadora = await abrir();
  m.pedir.mockRejectedValueOnce(new TypeError("Network error"));
  await grabadora.apartarCopia();
  expect(m.grabaciones.get("sesion-recuperada")).toEqual(original());
  expect(grabadora.snapshot().grabacion?.sesionId).toBe("sesion-recuperada");
});

test("si aborta la escritura del archivo, se mantiene el turno ocupado y se permite reintentar", async () => {
  const grabadora = await abrir();
  m.guardar.mockRejectedValueOnce(new Error("Transacción abortada"));
  await grabadora.apartarCopia();
  expect(m.grabaciones.get("sesion-recuperada")).toEqual(original());
  expect(grabadora.snapshot().grabacion?.sesionId).toBe("sesion-recuperada");
  await grabadora.apartarCopia();
  expect(grabadora.snapshot().grabacion).toBeNull();
});

test.each(["persistencia", "recorder"])("fallar al iniciar por %s vuelve a pausa y permite reintentar", async falla => {
  const grabadora = await abrir({ ...original(), estado: "pausada" });
  m.pedir.mockResolvedValue({ clave: "clave de prueba" });
  let fallarRecorder = falla === "recorder";
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop }], getAudioTracks: () => [new EventTarget()] }) } });
  class Recorder extends EventTarget {
    state = "inactive";
    mimeType = "audio/webm";
    static isTypeSupported() { return true; }
    constructor() { super(); if (fallarRecorder) { fallarRecorder = false; throw new Error("No pudo iniciar MediaRecorder"); } }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.dispatchEvent(new Event("stop")); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  if (falla === "persistencia") m.guardar.mockRejectedValueOnce(new Error("Transacción abortada"));
  await grabadora.iniciar();
  expect(grabadora.snapshot().grabacion?.estado).toBe("pausada");
  expect(m.grabaciones.get("sesion-recuperada")?.estado).toBe("pausada");
  expect(stop).toHaveBeenCalledOnce();
  expect(grabadora.snapshot().ocupada).toBe(false);
  await grabadora.iniciar();
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  expect(grabadora.snapshot().error).toBeNull();
});

test("terminar espera la subida en curso y envía el cierre antes de completar la acción", async () => {
  const g = { ...original(), estado: "pausada" as const };
  m.grabaciones.set(g.sesionId, g);
  let resolver!: (v: { estado: string }) => void;
  m.sincronizar.mockReset();
  m.sincronizar.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
  m.sincronizar.mockResolvedValue({ estado: "procesando" });
  const grabadora = new Grabadora("cuenta", "org", "turno");
  abiertas.push(grabadora);
  await grabadora.abrir();
  const cierre = grabadora.terminar();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(m.grabaciones.get(g.sesionId)?.estado).toBe("cerrada");
    expect(m.sincronizar).toHaveBeenCalledTimes(1);
    expect(m.sincronizar.mock.calls[0][1].estado).toBe("pausada");
  } finally { resolver({ estado: "grabando" }); }
  await cierre;
  expect(m.sincronizar).toHaveBeenCalledTimes(2);
  expect(m.sincronizar.mock.calls[1][1].estado).toBe("cerrada");
  expect(grabadora.snapshot().grabacion?.estado).toBe("entregada");
});


test.each(["ended"])("no inicia si %s ocurrió durante la escritura de arranque", async interrupcion => {
  const grabadora = await abrir({ ...original(), estado: "pausada" });
  m.pedir.mockResolvedValue({ clave: "prueba" });
  const pista = Object.assign(new EventTarget(), { muted: false, readyState: "live", stop: vi.fn() });
  vi.stubGlobal("MediaRecorder", vi.fn());
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [pista], getAudioTracks: () => [pista] }) } });
  m.guardar.mockImplementationOnce(async (_db, g: GrabacionLocal) => {
    m.grabaciones.set(g.sesionId, structuredClone(g));
    if (interrupcion === "hidden") vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    else if (interrupcion === "mute") pista.muted = true;
    else pista.readyState = "ended";
  });
  await grabadora.iniciar();
  expect(MediaRecorder).not.toHaveBeenCalled();
  expect(pista.stop).toHaveBeenCalledOnce();
  expect(grabadora.snapshot().grabacion?.estado).toBe("pausada");
  expect(grabadora.snapshot().error).toContain("antes de empezar");
  expect(m.grabaciones.get("sesion-recuperada")?.estado).toBe("pausada");
});

test("Reintentar consolida las entregas durables de una pieza que no se pudo escribir", async () => {
  m.sincronizar.mockResolvedValue({ estado: "grabando" });
  const grabadora = await abrir({ ...original(), estado: "pausada" });
  m.pedir.mockResolvedValue({ clave: "prueba" });
  m.segmento.mockImplementation(async (_db, g: GrabacionLocal) => { m.grabaciones.set(g.sesionId, structuredClone(g)); });
  const pista = Object.assign(new EventTarget(), { muted: false, readyState: "live", stop: vi.fn() });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [pista], getAudioTracks: () => [pista] }) } });
  class Recorder extends EventTarget {
    state = "inactive"; mimeType = "audio/webm";
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["audio sintético"]) })); this.dispatchEvent(new Event("stop")); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  await grabadora.iniciar();
  await vi.advanceTimersByTimeAsync(10000);
  m.segmento.mockRejectedValueOnce(new Error("Almacenamiento temporalmente ocupado"));
  await grabadora.pausar();
  expect(grabadora.snapshot().error).toBeTruthy();
  // Las entregas de esa pieza siguen guardadas; reintentar las incorpora.
  m.recuperar.mockImplementationOnce(async (_db: unknown, g: GrabacionLocal) => {
    const recuperada = { ...g, cantidad: g.cantidad + 1, duracionMs: g.duracionMs + 10_000 };
    m.grabaciones.set(g.sesionId, structuredClone(recuperada));
    return recuperada;
  });
  await grabadora.reintentar();
  const durable = m.grabaciones.get("sesion-recuperada");
  expect(durable).toMatchObject({ cantidad: 4, duracionMs: 130000 });
  expect(m.sincronizar.mock.lastCall?.[1]).toMatchObject({ cantidad: 4 });
  expect(grabadora.snapshot().error).toBeNull();
});


test("dos cuentas de la misma organización no pueden escribir el mismo turno en dos pestañas", async () => {
  const locks = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (nombre: string, _opts: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (locks.has(nombre)) return callback(null);
      locks.add(nombre);
      try { await callback({}); } finally { locks.delete(nombre); }
    },
  } });
  const primera = await abrir({ ...original(), estado: "pausada" });
  const segunda = new Grabadora("cuenta-distinta", "org", "turno");
  abiertas.push(segunda);
  await segunda.abrir();
  expect(segunda.snapshot().lista).toBe(false);
  expect(segunda.snapshot().error).toContain("otra pestaña");
  await primera.cerrar();
  await vi.advanceTimersByTimeAsync(0);
  const tercera = new Grabadora("cuenta-distinta", "org", "turno");
  abiertas.push(tercera);
  await tercera.abrir();
  expect(tercera.snapshot().lista).toBe(true);
});

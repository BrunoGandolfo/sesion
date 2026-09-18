// @vitest-environment jsdom
//
// Las cinco promesas del grabador, probadas por la puerta de adelante: sólo
// `Grabadora` y su vista. Nada acá conoce entregas, piezas ni corridas, a
// propósito: son los mismos casos que se probaron a mano en el teléfono, y
// tienen que poder correrse contra cualquier implementación del grabador.
//
// El doble de MediaRecorder es ASÍNCRONO como el de verdad: `stop()` vuelve
// enseguida y los eventos llegan en tareas posteriores. Un doble síncrono
// esconde exactamente los errores que rompieron la versión anterior.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Grabadora } from "@/lib/audio/grabadora";
import type { GrabacionLocal } from "@/lib/audio/almacen";

const mem = vi.hoisted(() => ({ grabaciones: new Map<string, unknown>(), segmentos: new Map<string, unknown>(), entregas: new Map<string, unknown>() }));
const llave = (...p: unknown[]) => JSON.stringify(p);

// Almacén en memoria con la semántica de IndexedDB que importa: `add` no pisa,
// y el cierre de una pieza retira sus entregas en la misma escritura.
vi.mock("@/lib/audio/almacen", () => ({
  abrirAlmacen: async () => ({ close() {} }),
  retirarCopiasViejas: async () => false,
  buscarGrabacion: async (_db: unknown, cuenta: string, turnoId: string) =>
    [...mem.grabaciones.values()].find((g) => (g as GrabacionLocal).cuenta === cuenta && (g as GrabacionLocal).turnoId === turnoId),
  guardarGrabacion: async (_db: unknown, g: GrabacionLocal) => { mem.grabaciones.set(llave(g.cuenta, g.sesionId), { ...g }); },
  guardarSegmento: async (_db: unknown, g: GrabacionLocal, s: { cuenta: string; sesionId: string; indice: number }) => {
    const clave = llave(s.cuenta, s.sesionId, s.indice);
    if (mem.segmentos.has(clave)) throw new Error("ConstraintError: la pieza ya existe");
    mem.segmentos.set(clave, { ...s });
    mem.entregas.clear();
    mem.grabaciones.set(llave(g.cuenta, g.sesionId), { ...g });
  },
  leerSegmento: async (_db: unknown, cuenta: string, sesionId: string, indice: number) => mem.segmentos.get(llave(cuenta, sesionId, indice)),
  guardarEntrega: async (_db: unknown, e: { cuenta: string; sesionId: string; indice: number; base: number }) => {
    const g = mem.grabaciones.get(llave(e.cuenta, e.sesionId)) as GrabacionLocal | undefined;
    if (g && g.cantidad === e.base && !["cerrada", "entregada"].includes(g.estado)) mem.entregas.set(llave(e.indice), { ...e });
  },
  recuperarEntregas: async (_db: unknown, g: GrabacionLocal) => g,
  // La versión anterior guardaba un prefijo acumulado; se declaran para que
  // este archivo también corra contra ella.
  guardarRespaldo: async () => {},
  recuperarRespaldo: async (_db: unknown, g: GrabacionLocal) => g,
}));

const red = vi.hoisted(() => ({ sincronizar: vi.fn(), pedir: vi.fn() }));
vi.mock("@/lib/audio/sincronizar", async () => {
  class ErrorAudio extends Error {
    constructor(message: string, readonly status: number, readonly conflicto = false) { super(message); }
  }
  return { ErrorAudio, pedirAudio: red.pedir, sincronizarAudio: red.sincronizar };
});
vi.mock("@/lib/audio/cifrado", () => ({
  importarClave: async () => ({}),
  cifrarSegmento: async (_b: Blob, _k: unknown, _o: string, _s: string, indice: number, inicioMs: number) =>
    ({ indice, inicioMs, bytes: 20, iv: "iv", sha256: `sha-${indice}`, cifrado: new ArrayBuffer(20) }),
}));

class Pista extends EventTarget {
  muted = false; readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
}
class Recorder extends EventTarget {
  static instancias: Recorder[] = [];
  static contestaStop = true;
  static isTypeSupported() { return true; }
  state = "inactive"; mimeType = "audio/webm"; intervalo?: ReturnType<typeof setInterval>;
  constructor() { super(); Recorder.instancias.push(this); }
  start = vi.fn((ms?: number) => { this.state = "recording"; if (ms) this.intervalo = setInterval(() => this.entregar(), ms); });
  entregar() { this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["audio"]) })); }
  stop() {
    clearInterval(this.intervalo);
    if (!Recorder.contestaStop) return;
    setTimeout(() => { this.state = "inactive"; this.entregar(); this.dispatchEvent(new Event("stop")); }, 30);
  }
}

let pista: Pista;
let reloj = 0;
const avanzar = async (ms: number, paso = 250) => {
  for (let corrido = 0; corrido < ms; corrido += paso) { reloj += paso; await vi.advanceTimersByTimeAsync(paso); }
};
/** El sistema congela la página: los temporizadores no corren, el reloj sí. */
const congelar = async (ms: number) => { reloj += ms; await vi.advanceTimersByTimeAsync(0); };
const microfono = () => {
  pista = new Pista();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [pista], getAudioTracks: () => [pista] }) } });
};

async function abrir() {
  const grabadora = new Grabadora("cuenta", "org", "turno");
  await grabadora.abrir();
  await vi.advanceTimersByTimeAsync(0);
  return grabadora;
}

beforeEach(async () => {
  vi.useFakeTimers();
  reloj = 0;
  vi.spyOn(performance, "now").mockImplementation(() => reloj);
  mem.grabaciones.clear(); mem.segmentos.clear(); mem.entregas.clear();
  Recorder.instancias = []; Recorder.contestaStop = true;
  red.sincronizar.mockReset().mockResolvedValue({ estado: "grabando", segmentos: [] });
  red.pedir.mockReset().mockImplementation(async (ruta: string) => ruta.endsWith("/clave") ? { clave: "k" } : ruta === "" ? { id: "sesion" } : { segmentos: [] });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: unknown, cb: (l: object) => Promise<void>) => cb({}) } });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", undefined);
  microfono();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("bloquear la pantalla no corta la grabación: al despertar sigue capturando", async () => {
  const grabadora = await abrir();
  await grabadora.iniciar();
  await avanzar(3000);
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");

  // Veinte segundos de pantalla bloqueada: ningún temporizador de la página
  // corre. El navegador siguió grabando y entrega lo pendiente al volver.
  await congelar(20_000);
  await avanzar(3000);

  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  expect(grabadora.snapshot().error).toBeNull();
  expect(pista.stop).not.toHaveBeenCalled();
});

test("un minuto entero sin que entre audio sí interrumpe, con explicación", async () => {
  const grabadora = await abrir();
  await grabadora.iniciar();
  await avanzar(2000);
  // El micrófono deja de entregar, pero la página sigue viva.
  clearInterval(Recorder.instancias[0].intervalo);
  await avanzar(61_000);
  expect(grabadora.snapshot().grabacion?.estado).toBe("interrumpida");
  // La razón concreta llega a la pantalla; no la tapa un texto genérico.
  expect(grabadora.snapshot().mensaje).toMatch(/no entra sonido/i);
  expect(grabadora.snapshot().mensaje).toMatch(/reanudar/i);
});

test("pausar y reanudar, tres veces seguidas", async () => {
  const grabadora = await abrir();
  for (const vuelta of [1, 2, 3]) {
    microfono();
    await grabadora.iniciar();
    await avanzar(3000);
    expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
    void grabadora.pausar();
    await avanzar(6000);
    expect(grabadora.snapshot().grabacion?.estado).toBe("pausada");
    expect(grabadora.snapshot().grabacion?.cantidad).toBe(vuelta);
    expect(grabadora.snapshot().error).toBeNull();
  }
});

test("una grabación corta se envía aunque el stop no llegue nunca", async () => {
  const grabadora = await abrir();
  await grabadora.iniciar();
  await avanzar(4000);
  // Una falla de envío anterior deja su cartel puesto, y el grabador no
  // contesta el stop: los dos hechos que dejaban Terminar sin efecto.
  red.sincronizar.mockRejectedValueOnce(new Error("sin conexión"));
  await grabadora.reintentar();
  expect(grabadora.snapshot().error).toBeTruthy();
  Recorder.contestaStop = false;

  void grabadora.terminar();
  await avanzar(12_000);

  expect(grabadora.snapshot().grabacion?.estado).toBe("cerrada");
  expect(grabadora.snapshot().grabacion?.cantidad).toBeGreaterThan(0);
  expect(grabadora.snapshot().ocupada).toBe(false);
});

test("nunca hay dos avisos de momentos distintos en pantalla", async () => {
  const grabadora = await abrir();
  await grabadora.iniciar();
  await avanzar(3000);
  void grabadora.pausar();
  await avanzar(6000);
  expect(grabadora.snapshot().mensaje).toBeTruthy();

  // Llega una falla de envío: reemplaza al aviso, no se suma.
  red.sincronizar.mockRejectedValueOnce(new Error("sin conexión"));
  await grabadora.reintentar();
  expect(grabadora.snapshot().error).toBeTruthy();
  expect(grabadora.snapshot().mensaje).toBe("");

  // Y el envío siguiente, que sale bien, retira la falla.
  await grabadora.reintentar();
  expect(grabadora.snapshot().error).toBeNull();
});

test("un desacuerdo con el servidor deja una salida, no un cartel eterno", async () => {
  const { ErrorAudio } = await import("@/lib/audio/sincronizar");
  const grabadora = await abrir();
  await grabadora.iniciar();
  await avanzar(3000);
  void grabadora.pausar();
  await avanzar(6000);

  red.sincronizar.mockRejectedValue(new ErrorAudio("El servidor tiene otro contenido para este tramo.", 409, true));
  await grabadora.reintentar();
  expect(grabadora.snapshot().desacuerdo).toBe("conflicto");

  await grabadora.apartarCopia();
  // La copia local se conserva entera, fuera del índice del turno, y la
  // pantalla vuelve a tener acciones.
  expect(grabadora.snapshot().grabacion).toBeNull();
  expect(grabadora.snapshot().error).toBeNull();
  expect(grabadora.snapshot().desacuerdo).toBeNull();
  expect([...mem.grabaciones.values()].some((g) => (g as GrabacionLocal).turnoId.includes(":archivo:"))).toBe(true);
  expect(mem.segmentos.size).toBeGreaterThan(0);
});

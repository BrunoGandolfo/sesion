// @vitest-environment jsdom
//
// Qué puede y qué no puede interrumpir una captura. La regla: sólo la prueba
// de que el micrófono dejó de estar —la pista muerta o silenciada, o un minuto
// de página viva sin una entrega—. Ocultar la página, bloquear la pantalla o
// que un temporizador llegue tarde no son pruebas de nada.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Grabadora } from "@/lib/audio/grabadora";
import type { GrabacionLocal } from "@/lib/audio/almacen";

const m = vi.hoisted(() => ({ guardar: vi.fn(), segmento: vi.fn(), entrega: vi.fn(), recuperar: vi.fn(), wake: vi.fn() }));
vi.mock("@/lib/audio/almacen", () => ({
  abrirAlmacen: async () => ({ close() {} }), retirarCopiasViejas: async () => false,
  buscarGrabacion: async () => ({ cuenta: "cuenta", organizationId: "org", turnoId: "turno", sesionId: "sesion", estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] } satisfies GrabacionLocal),
  guardarGrabacion: m.guardar, guardarSegmento: m.segmento, guardarEntrega: m.entrega, recuperarEntregas: m.recuperar,
}));
vi.mock("@/lib/audio/sincronizar", () => ({
  pedirAudio: async () => ({ clave: "prueba" }), sincronizarAudio: async () => ({ estado: "grabando" }), ErrorAudio: class extends Error {},
}));
vi.mock("@/lib/audio/cifrado", () => ({ importarClave: async () => ({}), cifrarSegmento: async (_b: Blob, _k: unknown, _o: string, _s: string, indice: number, inicioMs: number) => ({ indice, inicioMs, bytes: 20, iv: "iv", sha256: "sha", cifrado: new ArrayBuffer(20) }) }));

class Pista extends EventTarget {
  muted = false; readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  mute() { this.muted = true; this.dispatchEvent(new Event("mute")); }
  unmute() { this.muted = false; this.dispatchEvent(new Event("unmute")); }
}
class Recorder extends EventTarget {
  static instancias: Recorder[] = [];
  static isTypeSupported() { return true; }
  state = "inactive"; mimeType = "audio/webm"; intervalo?: ReturnType<typeof setInterval>;
  start = vi.fn((ms?: number) => { this.state = "recording"; if (ms) this.intervalo = setInterval(() => this.datos(), ms); });
  constructor() { super(); Recorder.instancias.push(this); }
  datos() { this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["audio"]) })); }
  stop() { clearInterval(this.intervalo); this.state = "inactive"; this.datos(); this.dispatchEvent(new Event("stop")); }
}
let grabadora: Grabadora;
let pista: Pista;
let visible: DocumentVisibilityState;
let lease: EventTarget & { released: boolean; release: ReturnType<typeof vi.fn> };
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); Recorder.instancias = [];
  m.recuperar.mockImplementation(async (_db: unknown, g: GrabacionLocal) => g);
  visible = "visible"; vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible);
  lease = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => { lease.released = true; }) });
  m.wake.mockImplementation(async () => {
    const nuevo = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => { nuevo.released = true; }) });
    lease = nuevo; return nuevo;
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: m.wake } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: unknown, cb: (l: object) => Promise<void>) => cb({}) } });
  pista = new Pista();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [pista], getAudioTracks: () => [pista] }) } });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", undefined);
  grabadora = new Grabadora("cuenta", "org", "turno"); await grabadora.abrir(); await grabadora.iniciar();
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(0); await grabadora.cerrar();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const ocultar = () => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); };
const mostrar = () => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); };

test("ocultar y volver no interrumpe ni finaliza una grabación que sigue entregando audio", async () => {
  ocultar(); await vi.advanceTimersByTimeAsync(20_000); mostrar();
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  expect(pista.stop).not.toHaveBeenCalled();
});

test("pide wake lock, lo recupera al volver y lo libera al pausar", async () => {
  expect(m.wake).toHaveBeenCalledWith("screen");
  ocultar(); lease.released = true; lease.dispatchEvent(new Event("release"));
  mostrar(); await vi.advanceTimersByTimeAsync(0);
  expect(m.wake).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000); await grabadora.pausar();
  expect(lease.release).toHaveBeenCalled();
});

test("unmute cancela los tres segundos de gracia, incluso si vuelve a silenciarse", async () => {
  pista.mute(); await vi.advanceTimersByTimeAsync(2900);
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  pista.unmute(); await vi.advanceTimersByTimeAsync(2000);
  pista.mute(); await vi.advanceTimersByTimeAsync(2900); pista.unmute();
  await vi.advanceTimersByTimeAsync(2000);
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
});

test("mute persistente interrumpe recién después de la gracia, con explicación", async () => {
  pista.mute(); await vi.advanceTimersByTimeAsync(2999);
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  await vi.advanceTimersByTimeAsync(1);
  expect(grabadora.snapshot().grabacion?.estado).toBe("interrumpida");
  expect(grabadora.snapshot().mensaje).toBeTruthy();
});

test("un hilo demorado no se confunde con un micrófono interrumpido", async () => {
  let reloj = 0; vi.spyOn(performance, "now").mockImplementation(() => reloj);
  reloj = 30_000; await vi.advanceTimersByTimeAsync(1000);
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
});

test("cada segundo entregado se guarda solo; la pieza recién se cierra al minuto", async () => {
  expect(Recorder.instancias[0].start).toHaveBeenCalledWith(1000);
  await vi.advanceTimersByTimeAsync(3_500);
  expect(m.entrega).toHaveBeenCalledTimes(3);
  expect(m.segmento).not.toHaveBeenCalled();
  expect(grabadora.snapshot().grabacion?.cantidad).toBe(0);
  // Un solo recorder para toda la corrida: nunca se rota.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.segmento).toHaveBeenCalledTimes(1);
  expect(Recorder.instancias).toHaveLength(1);
});

test("ended conserva una interrupción y nunca envía un cierre automático", async () => {
  await vi.advanceTimersByTimeAsync(1500);
  pista.readyState = "ended"; pista.dispatchEvent(new Event("ended"));
  await vi.advanceTimersByTimeAsync(100);
  expect(grabadora.snapshot().grabacion?.estado).toBe("interrumpida");
  expect(m.guardar.mock.calls.some(llamada => (llamada[1] as GrabacionLocal).estado === "cerrada")).toBe(false);
});

test("después de una interrupción se puede reanudar, y la corrida nueva no es continuación", async () => {
  await vi.advanceTimersByTimeAsync(2000);
  pista.readyState = "ended"; pista.dispatchEvent(new Event("ended"));
  await vi.advanceTimersByTimeAsync(100);
  expect(grabadora.snapshot().grabacion?.estado).toBe("interrumpida");
  pista = new Pista(); // getUserMedia entrega una pista nueva al reanudar.
  await grabadora.iniciar();
  expect(grabadora.snapshot().grabacion?.estado).toBe("capturando");
  await vi.advanceTimersByTimeAsync(1000);
  expect(m.entrega.mock.lastCall?.[1]).toMatchObject({ continuacion: false });
});

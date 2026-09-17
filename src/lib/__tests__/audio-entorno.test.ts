// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { abrirMedicion, EntornoAudio } from "@/lib/audio/entorno";
let entorno: EntornoAudio | undefined;
afterEach(() => { entorno?.cerrar(); entorno = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const stream = { getAudioTracks: () => [] } as unknown as MediaStream;

test("RMS menor a 0,012 durante dos minutos avisa; sonido reinicia el umbral", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let valor = 128;
  class Contexto {
    state = "running";
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData: (m: Uint8Array) => m.fill(valor) }; }
    createMediaStreamSource() { return { connect() {} }; }
    resume = async () => {}; close = async () => {};
  }
  vi.stubGlobal("AudioContext", Contexto);
  const nivel = vi.fn(); const interrumpir = vi.fn();
  entorno = new EntornoAudio(stream, interrumpir, nivel, abrirMedicion());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(nivel.mock.lastCall).toEqual([0, false]);
  await vi.advanceTimersByTimeAsync(100);
  expect(nivel.mock.lastCall).toEqual([0, true]);
  valor = 130; // RMS 0,015625, por encima del umbral original.
  await vi.advanceTimersByTimeAsync(100);
  expect(nivel.mock.lastCall).toEqual([0.09375, false]);
  expect(interrumpir).not.toHaveBeenCalled();
  entorno.cerrar(); nivel.mockClear(); await vi.advanceTimersByTimeAsync(1000);
  expect(nivel).not.toHaveBeenCalled();
});

test("un wake lock que llega después de pausar se libera", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let resolver!: (lease: object) => void;
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => new Promise(r => { resolver = r; }) } });
  entorno = new EntornoAudio(stream, vi.fn(), vi.fn(), null);
  entorno.cerrar();
  const release = vi.fn(async () => {});
  resolver({ release }); await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
});

test("sin wake lock o con permiso rechazado no interrumpe la captura", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { throw new Error("denegado"); } } });
  const interrumpir = vi.fn();
  entorno = new EntornoAudio(stream, interrumpir, vi.fn(), null);
  await entorno.recuperarPantalla();
  expect(interrumpir).not.toHaveBeenCalled();
});

test("el contexto se abre en el gesto, antes de esperar el permiso de micrófono", () => {
  const creados: object[] = [];
  class Contexto {
    state = "suspended";
    constructor() { creados.push(this); }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData: () => {} }; }
    createMediaStreamSource() { return { connect() {} }; }
    resume = vi.fn(async () => { this.state = "running"; }); close = async () => {};
  }
  vi.stubGlobal("AudioContext", Contexto);
  const medicion = abrirMedicion();
  // Se abre y se pide arrancar de una, sin ninguna espera de por medio: fuera
  // del gesto el navegador deja el contexto suspendido para siempre.
  expect(creados).toHaveLength(1);
  expect((medicion!.contexto as unknown as Contexto).resume).toHaveBeenCalled();
  medicion!.cerrar();
});

test("sin Web Audio el medidor dice que no está disponible y la captura sigue", () => {
  vi.stubGlobal("AudioContext", undefined);
  const nivel = vi.fn(); const interrumpir = vi.fn();
  entorno = new EntornoAudio(stream, interrumpir, nivel, abrirMedicion());
  expect(nivel).toHaveBeenCalledWith(null, false);
  expect(interrumpir).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { EntornoAudio } from "@/lib/audio/entorno";
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
  entorno = new EntornoAudio(stream, interrumpir, nivel);
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
  entorno = new EntornoAudio(stream, vi.fn(), vi.fn());
  entorno.cerrar();
  const release = vi.fn(async () => {});
  resolver({ release }); await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
});

test("sin wake lock o con permiso rechazado no interrumpe la captura", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { throw new Error("denegado"); } } });
  const interrumpir = vi.fn();
  entorno = new EntornoAudio(stream, interrumpir, vi.fn());
  await entorno.recuperarPantalla();
  expect(interrumpir).not.toHaveBeenCalled();
});

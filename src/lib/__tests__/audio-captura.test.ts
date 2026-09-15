import { afterEach, expect, test, vi } from "vitest";
import { CapturaAudio } from "@/lib/audio/captura";
import { cifrarSegmento, importarClave } from "@/lib/audio/cifrado";
import { aadSegmento } from "@/lib/audio/contrato";

class Recorder extends EventTarget {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["audio sintético"]) })); this.dispatchEvent(new Event("stop")); }
}
const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
afterEach(() => vi.useRealTimers());
function crear() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const duraciones: number[] = [];
  const inicios: number[] = [];
  const parada = vi.fn(async () => {});
  const captura = new CapturaAudio({ guardar: async (_b, ms, inicio) => { duraciones.push(ms); inicios.push(inicio); }, parada, error: vi.fn(), crearRecorder: () => new Recorder() as unknown as MediaRecorder });
  return { captura, duraciones, inicios, parada };
}
test("150 minutos medidos: solape una sola vez, límite pausa y no finaliza", async () => {
  const { captura, duraciones, inicios, parada } = crear();
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(9_000_000);
  expect(captura.grabando).toBe(false);
  expect(duraciones.reduce((a, b) => a + b, 0)).toBe(9_000_000);
  expect(parada).toHaveBeenCalledExactlyOnceWith("limite");
  expect(duraciones.length).toBeGreaterThan(150);
  expect(inicios[0]).toBe(0);
  expect(inicios.every((ms, i) => ms === i * 59000)).toBe(true);
});
test("pausar durante el solape no duplica audio; la pausa no cuenta", async () => {
  const { captura, duraciones, inicios } = crear();
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(59_500);
  await captura.pausar();
  await vi.advanceTimersByTimeAsync(120_000);
  captura.iniciar(stream, 59_500);
  await vi.advanceTimersByTimeAsync(10_500);
  await captura.pausar();
  expect(duraciones).toEqual([59_500, 0, 10_500]);
  expect(inicios).toEqual([0, 59_000, 59_500]);
  expect(captura.duracionMs).toBe(70_000);
});
test("AES-GCM binario con IV propio, clave no extraíble e identidad autenticada", async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const clave = await importarClave(Buffer.from(raw).toString("base64"));
  expect(clave.extractable).toBe(false);
  const a = await cifrarSegmento(new Blob(["audio"]), clave, "org", "sesion", 0, 0);
  const b = await cifrarSegmento(new Blob(["audio"]), clave, "org", "sesion", 1, 1100.25);
  expect(a.iv).not.toBe(b.iv); expect(a.bytes).toBe(21);
  expect(a.inicioMs).toBe(0); expect(b.inicioMs).toBe(1100.25);
  const abrir = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const iv = Buffer.from(a.iv, "base64");
  const texto = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aadSegmento("org", "sesion", 0) }, abrir, a.cifrado);
  expect(new TextDecoder().decode(texto)).toBe("audio");
  await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aadSegmento("otra", "sesion", 0) }, abrir, a.cifrado)).rejects.toThrow();
});

test("conserva el inicio medido aunque se retrase el cierre y acumula tras pausa", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  let retraso = 0;
  const medidas: { duracion: number; inicio: number }[] = [];
  const captura = new CapturaAudio({
    ahora: () => performance.now() + retraso,
    guardar: async (_blob, duracion, inicio) => { medidas.push({ duracion, inicio }); },
    parada: async () => {}, error: vi.fn(), crearRecorder: () => new Recorder() as unknown as MediaRecorder,
  });
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(59_900);
  retraso = 100.25;
  await vi.advanceTimersByTimeAsync(1000);
  await captura.pausar();
  expect(medidas).toEqual([{ duracion: 60_100.25, inicio: 0 }, { duracion: 900, inicio: 59000 }]);
  captura.iniciar(stream, 61_000.25);
  await vi.advanceTimersByTimeAsync(5000);
  await captura.pausar();
  expect(medidas[2]).toEqual({ duracion: 5000, inicio: 61000.25 });
});

test.each(["segmento", "pausa"])("reintentar tras un fallo al guardar %s conserva la pausa sin duplicar audio", async falla => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const duraciones: number[] = [];
  const pausas: string[] = [];
  let fallar = true;
  const captura = new CapturaAudio({
    guardar: async (_blob, ms) => {
      if (falla === "segmento" && fallar) { fallar = false; throw new Error("Transacción abortada"); }
      duraciones.push(ms);
    },
    parada: async motivo => {
      if (falla === "pausa" && fallar) { fallar = false; throw new Error("Transacción abortada"); }
      pausas.push(motivo);
    },
    error: vi.fn(), crearRecorder: () => new Recorder() as unknown as MediaRecorder,
  });
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(captura.pausar()).rejects.toThrow();
  expect(captura.grabando).toBe(false);
  await captura.drenar();
  expect(duraciones).toEqual([10_000]);
  expect(pausas).toEqual(["manual"]);
  captura.iniciar(stream, 10_000);
  await vi.advanceTimersByTimeAsync(5_000);
  await captura.pausar();
  expect(duraciones).toEqual([10_000, 5_000]);
  expect(pausas).toEqual(["manual", "manual"]);
});

test.each([true, false])("error del recorder: conserva los bytes finales disponibles=%s y permite reanudar", async hayAudio => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const recorder = new Recorder();
  const duraciones: number[] = [];
  const guardados: string[] = [];
  const error = vi.fn();
  const parada = vi.fn(async () => {});
  const captura = new CapturaAudio({
    guardar: async (blob, ms) => { guardados.push(await blob.text()); duraciones.push(ms); },
    parada, error, crearRecorder: () => recorder as unknown as MediaRecorder,
  });
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(10_000);
  recorder.state = "inactive";
  recorder.dispatchEvent(new Event("error"));
  expect(captura.grabando).toBe(false);
  expect(error).toHaveBeenCalled();
  recorder.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(hayAudio ? ["audio final recuperado"] : []) }));
  recorder.dispatchEvent(new Event("stop"));
  await captura.pausar();
  expect(guardados).toEqual(hayAudio ? ["audio final recuperado"] : []);
  expect(duraciones).toEqual(hayAudio ? [10_000] : []);
  expect(parada).toHaveBeenCalledExactlyOnceWith("interrupcion");
  captura.iniciar(stream, hayAudio ? 10_000 : 0);
  await vi.advanceTimersByTimeAsync(5_000);
  await captura.pausar();
  expect(duraciones).toEqual(hayAudio ? [10_000, 5_000] : [5_000]);
});

test("si falla el primero sin bytes, conserva el audio disponible del recorder superpuesto", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const recorders: Recorder[] = [];
  const duraciones: number[] = [];
  const captura = new CapturaAudio({
    guardar: async (_blob, ms) => { duraciones.push(ms); }, parada: async () => {}, error: vi.fn(),
    crearRecorder: () => { const r = new Recorder(); recorders.push(r); return r as unknown as MediaRecorder; },
  });
  captura.iniciar(stream, 0);
  await vi.advanceTimersByTimeAsync(59_500);
  recorders[0].state = "inactive";
  recorders[0].dispatchEvent(new Event("error"));
  recorders[0].dispatchEvent(new Event("stop"));
  await captura.pausar();
  expect(duraciones).toEqual([500]);
});

import { afterEach, expect, test, vi } from "vitest";
import { CapturaAudio, type OpcionesCaptura } from "@/lib/audio/captura";
import { cifrarSegmento, importarClave } from "@/lib/audio/cifrado";
import { aadSegmento } from "@/lib/audio/contrato";

/** Un MediaRecorder que entrega cada `ms` como el de verdad con start(ms). */
class Recorder extends EventTarget {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  intervalo?: ReturnType<typeof setInterval>;
  entregado = 0;
  start(ms?: number) {
    this.state = "recording";
    if (ms) this.intervalo = setInterval(() => this.entregar(), ms);
  }
  entregar() { this.entregado++; this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([`trozo ${this.entregado} `]) })); }
  stop() {
    clearInterval(this.intervalo);
    this.state = "inactive";
    this.entregar();
    this.dispatchEvent(new Event("stop"));
  }
}
const stream = () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream;

type Pieza = { duracion: number; inicio: number; continuacion: boolean; texto: string };
type Entrega = { orden: number; inicio: number; duracion: number; continuacion: boolean };

function crear(extra: Partial<OpcionesCaptura> = {}) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  const piezas: Pieza[] = [];
  const entregas: Entrega[] = [];
  const recorders: Recorder[] = [];
  const parada = vi.fn(async () => {});
  const error = vi.fn();
  const captura = new CapturaAudio({
    entregar: async (_trozo, e) => { entregas.push({ orden: e.orden, inicio: e.inicioMs, duracion: e.duracionMs, continuacion: e.continuacion }); },
    guardar: async (blob, duracion, inicio, continuacion) => { piezas.push({ duracion, inicio, continuacion, texto: await blob.text() }); },
    parada, error,
    crearRecorder: () => { const r = new Recorder(); recorders.push(r); return r as unknown as MediaRecorder; },
    ...extra,
  });
  return { captura, piezas, entregas, parada, error, recorders };
}
afterEach(() => vi.useRealTimers());

test("un solo recorder por corrida: las piezas se cortan en el acumulador, sin rotar ni solapar", async () => {
  const { captura, piezas, recorders } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(180_000);
  await captura.pausar();
  expect(recorders).toHaveLength(1);
  // Tres minutos = tres piezas de un minuto (más la cola que entrega el stop),
  // pegadas sin huecos ni repeticiones: sólo la primera trae cabecera.
  expect(piezas.slice(0, 3).map(p => p.inicio)).toEqual([0, 60_000, 120_000]);
  expect(piezas.slice(0, 3).map(p => p.duracion)).toEqual([60_000, 60_000, 60_000]);
  expect(piezas.map(p => p.continuacion)).toEqual([false, ...piezas.slice(1).map(() => true)]);
  expect(piezas.every((p, i) => i === 0 || p.inicio > piezas[i - 1].inicio)).toBe(true);
  expect(piezas.reduce((a, p) => a + p.duracion, 0)).toBe(180_000);
});

test("la primera pieza de cada corrida se decodifica sola; las de adentro son continuación", async () => {
  const { captura, piezas } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(70_000);
  await captura.pausar();
  captura.iniciar(stream(), 70_000);
  await vi.advanceTimersByTimeAsync(5_000);
  await captura.pausar();
  expect(piezas.map(p => ({ inicio: p.inicio, continuacion: p.continuacion }))).toEqual([
    { inicio: 0, continuacion: false },       // corrida 1, con cabecera
    { inicio: 60_000, continuacion: true },   // sigue el mismo archivo
    { inicio: 70_000, continuacion: false },  // corrida 2: recorder nuevo
  ]);
});

test("cada entrega de un segundo se guarda por separado, cubriendo el tiempo sin repetirlo", async () => {
  const { captura, entregas } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(entregas).toEqual([
    { orden: 0, inicio: 0, duracion: 1000, continuacion: false },
    { orden: 1, inicio: 1000, duracion: 1000, continuacion: true },
    { orden: 2, inicio: 2000, duracion: 1000, continuacion: true },
  ]);
  await captura.pausar();
  // Tras cerrar la pieza, la numeración de entregas vuelve a empezar.
  captura.iniciar(stream(), 3_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(entregas.at(-1)).toEqual({ orden: 0, inicio: 3_000, duracion: 1000, continuacion: false });
});

test("una página congelada no interrumpe nada: al volver sigue la misma corrida", async () => {
  let reloj = 0;
  const { captura, piezas, parada, error, recorders } = crear({ ahora: () => reloj });
  captura.iniciar(stream(), 0);
  for (let i = 0; i < 30; i++) { reloj += 1000; await vi.advanceTimersByTimeAsync(1000); }
  // Cuarenta segundos sin que corra un solo temporizador de la página.
  reloj += 40_000;
  await vi.advanceTimersByTimeAsync(1000);
  reloj += 1000;
  await vi.advanceTimersByTimeAsync(1000);
  expect(captura.grabando).toBe(true);
  expect(parada).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(recorders).toHaveLength(1);
  await captura.pausar();
  expect(piezas.reduce((a, p) => a + p.duracion, 0)).toBe(71_000);
});

test("un minuto de página viva sin una sola entrega sí interrumpe", async () => {
  const { captura, parada, error, recorders } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(2_000);
  clearInterval(recorders[0].intervalo);
  await vi.advanceTimersByTimeAsync(61_000);
  expect(captura.grabando).toBe(false);
  expect(parada).toHaveBeenCalledWith("interrupcion");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("no entra sonido"));
});

test("150 minutos medidos: el límite pausa y no finaliza nada", async () => {
  const { captura, piezas, parada } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(9_100_000);
  expect(captura.grabando).toBe(false);
  expect(piezas.reduce((a, p) => a + p.duracion, 0)).toBe(9_000_000);
  expect(parada).toHaveBeenCalledExactlyOnceWith("limite");
  expect(piezas[0].inicio).toBe(0);
});

test("la pausa conserva el inicio medido y la corrida siguiente acumula desde ahí", async () => {
  let retraso = 0;
  const { captura, piezas } = crear({ ahora: () => performance.now() + retraso });
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(59_900);
  retraso = 100.25;
  await vi.advanceTimersByTimeAsync(1_000);
  await captura.pausar();
  // El retraso del hilo entra en la medida, no la falsea: los inicios siguen
  // en orden estricto y las duraciones suman exactamente lo transcurrido.
  expect(piezas[0].inicio).toBe(0);
  expect(piezas.every((p, i) => i === 0 || p.inicio > piezas[i - 1].inicio)).toBe(true);
  expect(piezas.reduce((a, p) => a + p.duracion, 0)).toBeCloseTo(61_000.25, 5);
  captura.iniciar(stream(), 61_000.25);
  await vi.advanceTimersByTimeAsync(5_000);
  await captura.pausar();
  expect(piezas.at(-1)).toMatchObject({ duracion: 5_000, inicio: 61_000.25, continuacion: false });
});

test("si el stop no llega nunca, la pieza igual se cierra con lo entregado", async () => {
  const { captura, piezas, parada, error, recorders } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(4_000);
  vi.spyOn(recorders[0], "stop").mockImplementation(() => { clearInterval(recorders[0].intervalo); });
  const pausa = captura.pausar();
  await vi.advanceTimersByTimeAsync(6_000);
  await pausa;
  expect(piezas).toHaveLength(1);
  expect(piezas[0].texto).toContain("trozo 4");
  expect(parada).toHaveBeenCalledWith("manual");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("no respondió"));
});

test("un error del recorder interrumpe conservando lo entregado, y se puede reanudar", async () => {
  const { captura, piezas, parada, recorders } = crear();
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(10_000);
  recorders[0].dispatchEvent(new Event("error"));
  await vi.advanceTimersByTimeAsync(100);
  expect(captura.grabando).toBe(false);
  expect(parada).toHaveBeenCalledWith("interrupcion");
  expect(piezas[0].duracion).toBe(10_000);
  captura.iniciar(stream(), 10_000);
  await vi.advanceTimersByTimeAsync(5_000);
  await captura.pausar();
  expect(piezas.at(-1)).toMatchObject({ duracion: 5_000, inicio: 10_000 });
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

test("si la escritura de la pieza falla, la pausa igual queda registrada", async () => {
  const { captura, parada, entregas } = crear({
    guardar: async () => { throw new Error("Almacenamiento ocupado"); },
  });
  captura.iniciar(stream(), 0);
  await vi.advanceTimersByTimeAsync(4_000);
  await expect(captura.pausar()).rejects.toThrow("Almacenamiento ocupado");
  // La captura se detuvo: el estado tiene que decirlo, y el audio no se pierde
  // porque cada entrega ya está guardada por separado.
  expect(captura.grabando).toBe(false);
  expect(parada).toHaveBeenCalledExactlyOnceWith("manual");
  expect(entregas.length).toBeGreaterThanOrEqual(4);
});

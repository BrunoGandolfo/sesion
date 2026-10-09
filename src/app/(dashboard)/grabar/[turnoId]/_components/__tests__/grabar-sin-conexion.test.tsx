// @vitest-environment jsdom
//
// Grabar sin conexión (incidente del 9 de octubre de 2026: en modo avión,
// "Grabar sesión" decía "Algo falló" y no grababa). La pantalla de verdad, el
// grabador de verdad, api-client y la subida de verdad. Van doblados el
// navegador (micrófono, MediaRecorder, XMLHttpRequest), IndexedDB (en memoria)
// y la red: un fetch que, con `red.caida`, falla como falla sin señal.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ALGO_FALLO, GRABACION_LLEGO, GRABACION_SIN_CONEXION, REINTENTAR } from "@/lib/glosario";
import { claveSinTurno } from "@/lib/grabacion-clave";

import { GrabarView } from "../grabar-view";

// ─── IndexedDB en memoria ───────────────────────────────────────────────────
const disco = vi.hoisted(() => ({
  metas: new Map<string, { iniciadaEn: number; mimeType: string; turnoId?: string }>(),
  chunks: new Map<string, Blob[]>(),
}));
vi.mock("@/lib/grabacion-storage", () => ({
  iniciarSesionGrabacion: vi.fn(async (clave: string, mimeType: string) => {
    disco.metas.set(clave, { iniciadaEn: Date.now(), mimeType });
    disco.chunks.set(clave, []);
  }),
  guardarChunk: vi.fn(async (clave: string, _indice: number, blob: Blob) => {
    disco.chunks.get(clave)?.push(blob);
  }),
  guardarPausas: vi.fn(async () => {}),
  limpiarGrabacion: vi.fn(async (clave: string) => {
    disco.metas.delete(clave);
    disco.chunks.delete(clave);
  }),
  asociarTurno: vi.fn(async (clave: string, turnoId: string) => {
    const meta = disco.metas.get(clave);
    if (meta) meta.turnoId = turnoId;
  }),
  recuperarGrabacionPendiente: vi.fn(async (coincide: (clave: string, turnoId: string | null) => boolean = () => true) => {
    const [clave, meta] = [...disco.metas.entries()]
      .filter(([c, m]) => coincide(c, m.turnoId ?? null) && (disco.chunks.get(c)?.length ?? 0) > 0)
      .sort((a, b) => b[1].iniciadaEn - a[1].iniciadaEn)[0] ?? [];
    if (!clave || !meta) return null;
    const chunks = disco.chunks.get(clave)!;
    return {
      sesionClinicaId: clave, chunks, mimeType: meta.mimeType, duracionAproxSeg: chunks.length,
      pausas: [], iniciadaEn: meta.iniciadaEn, turnoId: meta.turnoId ?? null,
    };
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// ─── El navegador ───────────────────────────────────────────────────────────
const recorders: RecorderFalso[] = [];
class RecorderFalso {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { recorders.push(this); }
  static isTypeSupported() { return true; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.emitirChunk(); this.onstop?.(); }
  emitirChunk() { this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) }); }
}
const getUserMedia = vi.fn();

// ─── La red ─────────────────────────────────────────────────────────────────
const red = { caida: false };
const pedidos: string[] = [];
const cuerpos: Record<string, unknown> = {};
let sesionDelTurno: { id: string; estado: string } | null = null;

function responder(datos: unknown, status = 200) {
  return new Response(JSON.stringify(status < 300 ? { data: datos } : { error: datos }), {
    status, headers: { "content-type": "application/json" },
  });
}

async function fetchFalso(url: string, init?: RequestInit) {
  if (red.caida) throw new TypeError("Failed to fetch");
  const metodo = init?.method ?? "GET";
  const pedido = `${metodo} ${url}`;
  pedidos.push(pedido);
  if (init?.body) cuerpos[pedido] = JSON.parse(String(init.body));
  if (metodo === "GET" && url.startsWith("/api/sesion-clinica?turnoId=")) return responder(sesionDelTurno);
  if (metodo === "POST" && url === "/api/turnos") {
    const { fecha } = cuerpos[pedido] as { fecha: string };
    return responder({ id: "t-nuevo", fecha });
  }
  if (metodo === "POST" && url === "/api/sesion-clinica") {
    sesionDelTurno = { id: "s1", estado: "grabando" };
    return responder(sesionDelTurno);
  }
  if (url.endsWith("/upload-url")) return responder({ url: "https://r2.test/audio", key: "k", expiraEn: "2026-10-09T20:00:00.000Z", headers: {} });
  if (url.endsWith("/upload-confirmar")) return responder({ id: "s1", estado: "procesando" });
  if (metodo === "PATCH" && url.startsWith("/api/turnos/")) return responder({ id: url.split("/").at(-1) });
  return responder("no esperado", 500);
}

class XhrFalso {
  upload = {};
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(metodo: string, url: string) { pedidos.push(`${metodo} ${url}`); }
  setRequestHeader() {}
  send() {
    if (red.caida) { setTimeout(() => this.onerror?.(), 0); return; }
    this.status = 200;
    setTimeout(() => this.onload?.(), 0);
  }
}

// ─── Ayudas ─────────────────────────────────────────────────────────────────
const INICIO = new Date("2026-10-09T12:30:00.000Z"); // 09:30 en Montevideo
const SIN_TURNO = { turnoId: null, turnoProgramado: false, horaTexto: null, pacienteId: "p1", pacienteNombre: "Paciente Sintética", autorizacionVigente: true };
const CON_TURNO = { ...SIN_TURNO, turnoId: "t1", turnoProgramado: true, horaTexto: "09:30" };

async function grabar(segundos: number) {
  for (let t = 0; t < segundos; t += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
      recorders.at(-1)?.emitirChunk();
    });
  }
}

async function grabarYTerminar() {
  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  await waitFor(() => expect(recorders).toHaveLength(1));
  await grabar(12);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Terminar la sesión" }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(INICIO);
  recorders.length = 0;
  pedidos.length = 0;
  for (const k of Object.keys(cuerpos)) delete cuerpos[k];
  disco.metas.clear();
  disco.chunks.clear();
  red.caida = false;
  sesionDelTurno = null;
  vi.stubGlobal("MediaRecorder", RecorderFalso);
  vi.stubGlobal("XMLHttpRequest", XhrFalso);
  vi.stubGlobal("fetch", vi.fn(fetchFalso));
  const pista = { stop: vi.fn(), onended: null, onmute: null, onunmute: null };
  getUserMedia.mockReset().mockResolvedValue({ getAudioTracks: () => [pista], getTracks: () => [pista] });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sin red", () => {
  test.each([
    ["sin turno (desde la ficha)", SIN_TURNO],
    ["con turno agendado", CON_TURNO],
  ])("arrancar %s enciende el micrófono sin tocar la red", async (_caso, props) => {
    red.caida = true;
    render(<GrabarView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));

    await waitFor(() => expect(recorders).toHaveLength(1));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(recorders[0].state).toBe("recording");
    expect(screen.getByRole("button", { name: "Terminar la sesión" })).toBeTruthy();
    expect(screen.queryByText(ALGO_FALLO)).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test("terminar sin red deja la grabación en el teléfono, lo dice y ofrece Reintentar", async () => {
    red.caida = true;
    render(<GrabarView {...SIN_TURNO} />);
    await grabarYTerminar();

    expect(await screen.findByText(GRABACION_SIN_CONEXION)).toBeTruthy();
    expect(screen.getByRole("button", { name: REINTENTAR })).toBeTruthy();
    expect(screen.queryByText(ALGO_FALLO)).toBeNull();
    // Nada se borró: la grabación sigue guardada con su clave local.
    const clave = claveSinTurno("p1", INICIO);
    expect([...disco.metas.keys()]).toEqual([clave]);
    expect(disco.chunks.get(clave)!.length).toBeGreaterThanOrEqual(12);
    expect(pedidos).toEqual([]);
  });

  test("al volver la red, Reintentar crea el turno con la hora en que empezó, la sesión, y sube", async () => {
    red.caida = true;
    render(<GrabarView {...SIN_TURNO} />);
    await grabarYTerminar();
    await screen.findByText(GRABACION_SIN_CONEXION);

    // Volvió la señal una hora después.
    vi.setSystemTime(new Date(INICIO.getTime() + 60 * 60_000));
    red.caida = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(pedidos).toEqual([
      "POST /api/turnos",
      "GET /api/sesion-clinica?turnoId=t-nuevo",
      "POST /api/sesion-clinica",
      "POST /api/sesion-clinica/s1/upload-url",
      "PUT https://r2.test/audio",
      "POST /api/sesion-clinica/s1/upload-confirmar",
      "PATCH /api/turnos/t-nuevo",
    ]);
    expect(cuerpos["POST /api/turnos"]).toEqual(expect.objectContaining({
      pacienteId: "p1", alGrabar: true, fecha: INICIO.toISOString(), iniciadaEn: INICIO.toISOString(),
    }));
    expect(cuerpos["POST /api/sesion-clinica"]).toEqual({ turnoId: "t-nuevo", iniciadaEn: INICIO.toISOString() });
    // Con la confirmación, la copia del teléfono sobra.
    expect(disco.metas.size).toBe(0);
  });
});

describe("con red", () => {
  test("con turno agendado, el camino es el de siempre: sesión, URL, PUT, confirmar, realizado", async () => {
    sesionDelTurno = { id: "s1", estado: "grabando" };
    render(<GrabarView {...CON_TURNO} />);
    fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    // Grabar no espera al servidor tampoco con red.
    expect(pedidos).toEqual([]);
    await grabar(12);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Terminar la sesión" }));
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(pedidos).toEqual([
      "GET /api/sesion-clinica?turnoId=t1",
      "POST /api/sesion-clinica/s1/upload-url",
      "PUT https://r2.test/audio",
      "POST /api/sesion-clinica/s1/upload-confirmar",
      "PATCH /api/turnos/t1",
    ]);
    expect(pedidos.some((p) => p === "POST /api/turnos")).toBe(false);
  });
});

describe("al volver a entrar con una grabación sin turno guardada", () => {
  const AYER = new Date("2026-10-08T21:10:00.000Z");
  const CLAVE = claveSinTurno("p1", AYER);

  function guardada(turnoId?: string) {
    disco.metas.set(CLAVE, { iniciadaEn: AYER.getTime(), mimeType: "audio/webm", ...(turnoId ? { turnoId } : {}) });
    disco.chunks.set(CLAVE, Array.from({ length: 30 }, () => new Blob(["audio"], { type: "audio/webm" })));
  }

  test("se ofrece, y al guardarla crea el turno con la fecha original, no con la de hoy", async () => {
    guardada();
    render(<GrabarView {...SIN_TURNO} />);
    const guardarla = await screen.findByRole("button", { name: "Guardarla ahora" });
    await act(async () => {
      fireEvent.click(guardarla);
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(cuerpos["POST /api/turnos"]).toEqual(expect.objectContaining({ fecha: AYER.toISOString(), alGrabar: true, iniciadaEn: AYER.toISOString() }));
    expect(cuerpos["POST /api/sesion-clinica"]).toEqual({ turnoId: "t-nuevo", iniciadaEn: AYER.toISOString() });
    expect(pedidos.filter((p) => p === "POST /api/turnos")).toHaveLength(1);
    expect(disco.metas.has(CLAVE)).toBe(false);
  });

  test("si su turno ya se había creado en un intento anterior, no se crea otro", async () => {
    guardada("t-anterior");
    sesionDelTurno = { id: "s1", estado: "grabando" };
    render(<GrabarView {...SIN_TURNO} />);
    const guardarla = await screen.findByRole("button", { name: "Guardarla ahora" });
    await act(async () => {
      fireEvent.click(guardarla);
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(pedidos.some((p) => p === "POST /api/turnos")).toBe(false);
    expect(pedidos).toContain("GET /api/sesion-clinica?turnoId=t-anterior");
    expect(pedidos).toContain("PATCH /api/turnos/t-anterior");
  });

  test("si su turno ya se creó, también se ofrece entrando por ese turno (como llega desde la ficha)", async () => {
    guardada("t-anterior");
    sesionDelTurno = { id: "s1", estado: "grabando" };
    render(<GrabarView {...CON_TURNO} turnoId="t-anterior" />);
    const guardarla = await screen.findByRole("button", { name: "Guardarla ahora" });
    await act(async () => {
      fireEvent.click(guardarla);
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(pedidos.some((p) => p === "POST /api/turnos")).toBe(false);
    expect(pedidos).toContain("POST /api/sesion-clinica/s1/upload-confirmar");
    // Se borra con SU clave, no con la del turno.
    expect(disco.metas.has(CLAVE)).toBe(false);
  });

  test("entrando por otro turno no se ofrece", async () => {
    guardada("t-anterior");
    render(<GrabarView {...CON_TURNO} turnoId="t-otro" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByRole("button", { name: "Guardarla ahora" })).toBeNull();
  });

  test("la de un turno agendado de ayer, que no llegó a subir, se ofrece aunque ya no se pueda grabar una nueva", async () => {
    // Grabada ayer a las 18:10 con el turno t-ayer, sin red, y el navegador
    // se cerró: no hay sesión en el servidor. Hoy la página dice que el turno
    // ya no se graba, pero lo guardado se envía con su inicio.
    disco.metas.set("t-ayer", { iniciadaEn: AYER.getTime(), mimeType: "audio/webm" });
    disco.chunks.set("t-ayer", Array.from({ length: 30 }, () => new Blob(["audio"], { type: "audio/webm" })));
    render(<GrabarView {...CON_TURNO} turnoId="t-ayer" motivoSinGrabar="Solo se puede grabar un turno el mismo día." />);

    const guardarla = await screen.findByRole("button", { name: "Guardarla ahora" });
    expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
    expect(screen.getByText("Solo se puede grabar un turno el mismo día.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(guardarla);
    });

    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
    expect(cuerpos["POST /api/sesion-clinica"]).toEqual({ turnoId: "t-ayer", iniciadaEn: AYER.toISOString() });
    expect(disco.metas.has("t-ayer")).toBe(false);
  });

  test("sin red, guardarla deja la grabación donde estaba y lo dice", async () => {
    guardada();
    red.caida = true;
    render(<GrabarView {...SIN_TURNO} />);
    const guardarla = await screen.findByRole("button", { name: "Guardarla ahora" });
    await act(async () => {
      fireEvent.click(guardarla);
    });

    expect(await screen.findByText(GRABACION_SIN_CONEXION)).toBeTruthy();
    expect(disco.metas.has(CLAVE)).toBe(true);
  });
});

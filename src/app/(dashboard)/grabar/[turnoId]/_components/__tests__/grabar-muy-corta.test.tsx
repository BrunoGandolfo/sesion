// @vitest-environment jsdom
//
// Un toque accidental: la pantalla de verdad con el grabador de verdad. Sólo
// van doblados el navegador (micrófono, MediaRecorder, IndexedDB) y la red,
// que acá es el testigo: si algo intentara subir, se vería en `pedidos`.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GRABACION_MUY_CORTA } from "@/lib/glosario";
import { limpiarGrabacion } from "@/lib/grabacion-storage";

import { GrabarView } from "../grabar-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/grabacion-storage", () => ({
  guardarChunk: vi.fn(async () => {}),
  guardarPausas: vi.fn(async () => {}),
  iniciarSesionGrabacion: vi.fn(async () => {}),
  limpiarGrabacion: vi.fn(async () => {}),
  recuperarGrabacionPendiente: vi.fn(async () => null),
}));

const recorders: RecorderFalso[] = [];
const pedidos: string[] = [];
const xhrAbiertos: string[] = [];

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
  emitirChunk() { this.ondataavailable?.({ data: new Blob(["audio"]) }); }
}

async function grabar(segundos: number) {
  for (let t = 0; t < segundos; t += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
      recorders.at(-1)?.emitirChunk();
    });
  }
}

const props = { turnoId: "t1", turnoProgramado: true, horaTexto: "12:00", pacienteId: "p1", pacienteNombre: "Paciente Sintética", autorizacionVigente: true };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-19T13:00:00.000Z"));
  recorders.length = 0;
  pedidos.length = 0;
  xhrAbiertos.length = 0;
  vi.stubGlobal("MediaRecorder", RecorderFalso);
  const pista = { stop: vi.fn(), onended: null, onmute: null, onunmute: null };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getAudioTracks: () => [pista], getTracks: () => [pista] }) },
  });
  // La API: la sesión del turno ya existe y está en "grabando".
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    pedidos.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ data: { id: "s1", estado: "grabando" } }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  vi.stubGlobal("XMLHttpRequest", class { open(_m: string, url: string) { xhrAbiertos.push(url); } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("tres segundos y Terminar: lo dice en una frase, no sube nada y deja grabar de nuevo en el mismo turno", async () => {
  render(<GrabarView {...props} />);

  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  await waitFor(() => expect(recorders).toHaveLength(1));
  await grabar(3);
  fireEvent.click(screen.getByRole("button", { name: "Terminar la sesión" }));

  expect(screen.getByText(GRABACION_MUY_CORTA)).toBeTruthy();
  expect(GRABACION_MUY_CORTA).toBe("Grabaste menos de 10 segundos. No se guardó nada.");
  expect(limpiarGrabacion).toHaveBeenCalledWith("t1");

  // Nada salió hacia la subida: ni la URL firmada, ni el PUT, ni la confirmación.
  expect(pedidos).toEqual(["GET /api/sesion-clinica?turnoId=t1"]);
  expect(xhrAbiertos).toEqual([]);

  // El botón de grabar está de vuelta y activo, y graba sobre la MISMA sesión
  // del servidor: la vuelve a encontrar en "grabando", no crea otra.
  const grabarDeNuevo = screen.getByRole("button", { name: "Grabar sesión" }) as HTMLButtonElement;
  expect(grabarDeNuevo.disabled).toBe(false);
  fireEvent.click(grabarDeNuevo);
  await waitFor(() => expect(recorders).toHaveLength(2));
  expect(screen.queryByText(GRABACION_MUY_CORTA)).toBeNull();
  expect(pedidos).toEqual(["GET /api/sesion-clinica?turnoId=t1", "GET /api/sesion-clinica?turnoId=t1"]);
  expect(pedidos.some((p) => p.startsWith("POST"))).toBe(false);
});

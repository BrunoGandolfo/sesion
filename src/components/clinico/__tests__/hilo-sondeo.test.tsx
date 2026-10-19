// @vitest-environment jsdom
//
// C10: mientras hay un trabajo del Recorrido en curso, la pantalla vuelve a
// leer cada 12 s. Con la pestaña oculta no lee (como el sondeo de la nota y
// el aviso de notas), al volver lee enseguida, y nunca encima de una lectura
// que todavía no contestó.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { apiGet } from "@/lib/api-client";
import { hiloVacio, type Recorrido } from "@/lib/hilo/contenido";

import { HiloView } from "../HiloView";

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const INTERVALO = 12_000;

const recorrido = (): Recorrido => ({
  pacienteId: "p1",
  vigente: {
    id: "v1", version: 1, basadaEnVersion: null, actor: "profesional", estado: "aplicada",
    sesionOrigenId: null, creadaPorUserId: "u", creadaEn: "2026-09-01T15:00:00Z", resueltaEn: null,
    resueltaPorUserId: null, propuestaOrigenId: null,
    contenido: { ...hiloVacio(), resumenAcumulativo: "Mi historia" },
  },
  propuesta: null, historial: [], desactualizadas: [], hayMas: false,
  totalSesionesAprobadas: 1, sesionesAprobadas: [],
  trabajos: [{ id: "tr", sesionId: "s", estado: "en_curso" }],
});

let visibilidad: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  visibilidad = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidad);
  vi.mocked(apiGet).mockReset().mockImplementation(async () => recorrido());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pasar(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function cambiarVisibilidad(estado: DocumentVisibilityState) {
  visibilidad = estado;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

async function montar() {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  await screen.findByText("Mi historia");
  vi.mocked(apiGet).mockClear();
}

it("con un trabajo en curso vuelve a leer cada 12 s", async () => {
  await montar();
  await pasar(INTERVALO);
  expect(apiGet).toHaveBeenCalledTimes(1);
  await pasar(INTERVALO);
  expect(apiGet).toHaveBeenCalledTimes(2);
});

it("con la pestaña oculta no lee; al volver, lee enseguida", async () => {
  await montar();
  cambiarVisibilidad("hidden");
  await pasar(INTERVALO * 4);
  expect(apiGet).not.toHaveBeenCalled();

  cambiarVisibilidad("visible");
  await pasar(0);
  expect(apiGet).toHaveBeenCalledTimes(1);
});

it("no lee encima de una lectura que todavía no contestó", async () => {
  await montar();
  vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}));
  await pasar(INTERVALO * 4);
  expect(apiGet).toHaveBeenCalledTimes(1);
});

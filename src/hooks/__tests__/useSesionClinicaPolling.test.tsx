// @vitest-environment jsdom
//
// C10: el sondeo de la sesión mientras se escribe la nota. Hasta ahora los
// cinco tests que lo tocaban lo reemplazaban con vi.mock: el bucle no tenía
// ningún test propio (2,8 % de cobertura). Lo que se fija acá:
//   - sigue consultando mientras la sesión está en el pipeline y para en un
//     estado terminal;
//   - con la pestaña oculta no consulta, y al volver retoma;
//   - al cambiar de sesión aborta el pedido anterior y no muestra su
//     resultado.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSesionClinicaPolling } from "../useSesionClinicaPolling";

const m = vi.hoisted(() => ({
  get: vi.fn<(url: string, opciones?: { signal?: AbortSignal }) => Promise<unknown>>(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

const INTERVALO = 1000;

function fila(id: string, estado: string) {
  return {
    id, turnoId: `t-${id}`, estado, audioEstado: null, duracionAudioSeg: null, intento: 1,
    generacion: 1, falloCodigo: null, falloDetalle: null, notaIa: null, notaFinal: null,
    datos: null, feedback: null, feedbackEstado: null, modeloAsr: null, modeloLlm: null,
    procesadaEn: null, aprobadaEn: null, creadaEn: "2026-09-16T12:00:00.000Z",
    actualizadaEn: "2026-09-16T12:00:00.000Z",
  };
}

let visibilidad: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  m.get.mockReset();
  visibilidad = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidad);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Deja correr las promesas pendientes y, si hace falta, el intervalo. */
async function pasar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function cambiarVisibilidad(estado: DocumentVisibilityState) {
  visibilidad = estado;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useSesionClinicaPolling", () => {
  it("consulta mientras la nota se escribe y para cuando llega a un estado terminal", async () => {
    const estados = ["procesando", "procesando", "revision"];
    m.get.mockImplementation(async () => fila("s", estados.shift() ?? "revision"));

    const { result } = renderHook(() =>
      useSesionClinicaPolling({ sesionClinicaId: "s", intervaloMs: INTERVALO }),
    );
    await pasar();
    expect(m.get).toHaveBeenCalledTimes(1);
    expect(m.get.mock.calls[0]![0]).toBe("/api/sesion-clinica/s");
    expect(result.current.data?.estado).toBe("procesando");

    await pasar(INTERVALO);
    expect(m.get).toHaveBeenCalledTimes(2);

    await pasar(INTERVALO);
    expect(m.get).toHaveBeenCalledTimes(3);
    expect(result.current.data?.estado).toBe("revision");

    // Ya no hay nada que esperar: no vuelve a consultar.
    await pasar(INTERVALO * 5);
    expect(m.get).toHaveBeenCalledTimes(3);
  });

  it("con la pestaña oculta no consulta; al volver, retoma", async () => {
    m.get.mockImplementation(async () => fila("s", "procesando"));
    renderHook(() => useSesionClinicaPolling({ sesionClinicaId: "s", intervaloMs: INTERVALO }));
    await pasar();
    expect(m.get).toHaveBeenCalledTimes(1);

    cambiarVisibilidad("hidden");
    await pasar(INTERVALO * 5);
    expect(m.get).toHaveBeenCalledTimes(1);

    cambiarVisibilidad("visible");
    await pasar();
    expect(m.get).toHaveBeenCalledTimes(2);
  });

  it("al cambiar de sesión aborta el pedido anterior y no muestra su resultado", async () => {
    let entregarVieja: (valor: unknown) => void = () => {};
    let senalVieja: AbortSignal | undefined;
    m.get.mockImplementation((url, opciones) => {
      if (url.endsWith("/vieja")) {
        senalVieja = opciones?.signal;
        return new Promise((resolver) => { entregarVieja = resolver; });
      }
      return Promise.resolve(fila("nueva", "revision"));
    });

    const { result, rerender } = renderHook(
      ({ id }) => useSesionClinicaPolling({ sesionClinicaId: id, intervaloMs: INTERVALO }),
      { initialProps: { id: "vieja" } },
    );
    await pasar();
    rerender({ id: "nueva" });
    await pasar();
    expect(senalVieja?.aborted).toBe(true);
    expect(result.current.data?.id).toBe("nueva");

    // La respuesta de la vieja llega tarde: no pisa la nueva.
    await act(async () => { entregarVieja(fila("vieja", "procesando")); });
    await pasar();
    expect(result.current.data?.id).toBe("nueva");
  });

  it("deshabilitado no consulta ni devuelve datos", async () => {
    const { result } = renderHook(() =>
      useSesionClinicaPolling({ sesionClinicaId: "s", enabled: false }),
    );
    await pasar(INTERVALO * 3);
    expect(m.get).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });

  it("si falla, lo dice con las palabras de la app", async () => {
    m.get.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useSesionClinicaPolling({ sesionClinicaId: "s" }));
    await pasar();
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toMatch(/Failed to fetch/);
  });
});

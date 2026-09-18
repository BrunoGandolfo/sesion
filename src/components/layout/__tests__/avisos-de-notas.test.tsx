// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvisosDeNotas } from "@/components/layout/avisos-de-notas";
import { IndicadorProcesando } from "@/components/ui/procesando";
import { INTERVALO_CONSULTA_MS, olvidarNotas, seguirNota } from "@/lib/notas-en-proceso";

const lucia = { sesionId: "s1", turnoId: "t1", paciente: "Lucía Fernández" };

let estadoServidor: string | null;
const fetchMock = vi.fn(async () =>
  new Response(
    JSON.stringify({ data: estadoServidor ? { id: "s1", estado: estadoServidor } : null }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ),
);

async function pasar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  estadoServidor = "procesando";
  act(() => olvidarNotas());
});

afterEach(() => {
  act(() => olvidarNotas());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AvisosDeNotas", () => {
  it("sin sesiones en proceso no hace ningún pedido", async () => {
    render(<AvisosDeNotas />);
    await pasar(INTERVALO_CONSULTA_MS * 10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("consulta cada tanto mientras procesa, avisa al pasar a revision y deja de consultar", async () => {
    render(<AvisosDeNotas />);
    act(() => seguirNota(lucia));

    await pasar(INTERVALO_CONSULTA_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(
      expect.arrayContaining(["/api/sesion-clinica?turnoId=t1"]),
    );
    expect(screen.queryByText(/está lista/)).toBeNull();

    estadoServidor = "revision";
    await pasar(INTERVALO_CONSULTA_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Revisar" }).getAttribute("href")).toBe("/sesiones/s1");

    await pasar(INTERVALO_CONSULTA_MS * 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // No se va solo.
    expect(screen.getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
  });

  it("avisa el fallo y lleva a la nota, donde está Reintentar", async () => {
    render(<AvisosDeNotas />);
    act(() => seguirNota(lucia));
    estadoServidor = "fallida";
    await pasar(INTERVALO_CONSULTA_MS);
    expect(screen.getByRole("alert").textContent).toContain("No pudimos escribir la nota de Lucía Fernández");
    expect(screen.getByRole("link", { name: "Ver qué pasó" }).getAttribute("href")).toBe("/sesiones/s1");
  });

  it("la cruz lo cierra, y volver a ver la sesión en proceso no lo repite", async () => {
    render(<AvisosDeNotas />);
    act(() => seguirNota(lucia));
    estadoServidor = "revision";
    await pasar(INTERVALO_CONSULTA_MS);
    act(() => screen.getByRole("button", { name: "Cerrar aviso" }).click());
    expect(screen.queryByText(/está lista/)).toBeNull();

    act(() => seguirNota(lucia));
    await pasar(INTERVALO_CONSULTA_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/está lista/)).toBeNull();
  });

  it("con la pantalla oculta no pregunta", async () => {
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<AvisosDeNotas />);
    act(() => seguirNota(lucia));
    await pasar(INTERVALO_CONSULTA_MS * 4);
    expect(fetchMock).not.toHaveBeenCalled();
    vis.mockReturnValue("visible");
    await pasar(INTERVALO_CONSULTA_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un error de red no pierde la sesión: se vuelve a preguntar", async () => {
    render(<AvisosDeNotas />);
    act(() => seguirNota(lucia));
    fetchMock.mockRejectedValueOnce(new TypeError("sin red"));
    await pasar(INTERVALO_CONSULTA_MS);
    estadoServidor = "revision";
    await pasar(INTERVALO_CONSULTA_MS);
    expect(screen.getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
  });
});

describe("IndicadorProcesando", () => {
  it("dice Procesando con el nombre de la paciente", () => {
    render(<IndicadorProcesando paciente="Lucía Fernández" />);
    expect(screen.getByRole("status").textContent).toContain("Procesando la sesión de Lucía Fernández");
  });
});

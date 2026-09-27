// @vitest-environment jsdom
// Carga, error, reintento, vacío y el pedido que sale de cada chip.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALGO_FALLO,
  FINANZAS,
  REINTENTAR,
  SIN_SESIONES_REGISTRADAS,
} from "@/lib/glosario";

import { FinanzasView } from "../finanzas-view";
import { RESPUESTA_EJEMPLO } from "./respuesta-ejemplo";

const { apiGet, push } = vi.hoisted(() => ({ apiGet: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet,
}));

beforeEach(() => {
  apiGet.mockReset();
  push.mockReset();
});

it("mientras llega la primera respuesta muestra el esqueleto con el título", async () => {
  apiGet.mockReturnValue(new Promise(() => {}));
  render(<FinanzasView />);
  expect(screen.getByRole("heading", { level: 1, name: FINANZAS })).toBeTruthy();
  // El cuerpo del esqueleto, como en Cobros: huecos sin texto.
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(apiGet).toHaveBeenCalledWith("/api/finanzas/resumen", expect.anything());
});

it("si falla dice que falló y reintenta", async () => {
  apiGet.mockRejectedValueOnce(new Error("red")).mockResolvedValueOnce(RESPUESTA_EJEMPLO);
  render(<FinanzasView />);
  expect(await screen.findByText(ALGO_FALLO)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
  await waitFor(() => expect(screen.queryByText(ALGO_FALLO)).toBeNull());
  expect(apiGet).toHaveBeenCalledTimes(2);
});

it("sin un solo turno muestra el vacío con Lupita y lleva a la agenda", async () => {
  apiGet.mockResolvedValue({ ...RESPUESTA_EJEMPLO, primerMesConDatos: null });
  const { container } = render(<FinanzasView />);
  expect(await screen.findByRole("heading", { name: SIN_SESIONES_REGISTRADAS })).toBeTruthy();
  expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  // Sin datos no hay período que elegir.
  expect(screen.queryByRole("tablist")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ir a la agenda" }));
  expect(push).toHaveBeenCalledWith("/agenda");
});

it("cada chip pide su período, con el mes de hoy que dice el servidor", async () => {
  apiGet.mockResolvedValue(RESPUESTA_EJEMPLO);
  render(<FinanzasView />);
  await screen.findByRole("tablist");

  fireEvent.click(screen.getByRole("tab", { name: "Este mes" }));
  await waitFor(() =>
    expect(apiGet).toHaveBeenLastCalledWith("/api/finanzas/resumen?desde=2026-09&hasta=2026-09", expect.anything()),
  );

  fireEvent.click(screen.getByRole("tab", { name: "Todo" }));
  await waitFor(() =>
    expect(apiGet).toHaveBeenLastCalledWith(
      "/api/finanzas/resumen?desde=2025-09&hasta=2026-09&granularidad=anio",
      expect.anything(),
    ),
  );

  fireEvent.click(screen.getByRole("tab", { name: "Este año" }));
  await waitFor(() =>
    expect(apiGet).toHaveBeenLastCalledWith("/api/finanzas/resumen?desde=2026-01&hasta=2026-09", expect.anything()),
  );
  // El ‹ año › llega hasta el primer año con datos (2025) y no pasa de hoy.
  expect((screen.getByRole("button", { name: "Año siguiente" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Año anterior" }));
  await waitFor(() =>
    expect(apiGet).toHaveBeenLastCalledWith("/api/finanzas/resumen?desde=2025-01&hasta=2025-12", expect.anything()),
  );
  expect((screen.getByRole("button", { name: "Año anterior" }) as HTMLButtonElement).disabled).toBe(true);
});

// En enero "Este mes" y "Este año" piden lo mismo: no sale pedido nuevo, y la
// pantalla no puede quedar ocupada esperando una respuesta que no viene.
describe("dos chips que piden lo mismo", () => {
  const enero = {
    ...RESPUESTA_EJEMPLO,
    deudaHoy: { ...RESPUESTA_EJEMPLO.deudaHoy, alDia: "2026-01" },
  };
  const QUERY_ENERO = "/api/finanzas/resumen?desde=2026-01&hasta=2026-01";

  it("no deja la pantalla cargando", async () => {
    apiGet.mockResolvedValue(enero);
    const { container } = render(<FinanzasView />);
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "Este mes" }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(QUERY_ENERO, expect.anything()));
    await waitFor(() => expect(container.querySelector("[aria-busy='true']")).toBeNull());
    const pedidos = apiGet.mock.calls.length;
    fireEvent.click(screen.getByRole("tab", { name: "Este año" }));
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
    expect(apiGet).toHaveBeenCalledTimes(pedidos);
  });

  it("si lo último falló, reintenta en vez de esconder el error", async () => {
    apiGet.mockResolvedValueOnce(enero).mockRejectedValueOnce(new Error("red")).mockResolvedValue(enero);
    render(<FinanzasView />);
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "Este mes" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Este año" }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3));
    expect(apiGet).toHaveBeenLastCalledWith(QUERY_ENERO, expect.anything());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

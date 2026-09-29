// @vitest-environment jsdom
// La tarjeta que lleva de Cobros a Finanzas: con el dato del mes y sin él.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FINANZAS_TARJETA_SIN_DATO } from "@/lib/glosario";

import { RESPUESTA_EJEMPLO } from "../../../finanzas/_components/__tests__/respuesta-ejemplo";
import { TarjetaFinanzas } from "../tarjeta-finanzas";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet,
}));

// Lo que contesta el servidor a un pedido de un mes: el período es ese mes
// y la comparación, el anterior.
const SEPTIEMBRE = {
  ...RESPUESTA_EJEMPLO,
  desde: "2026-09",
  hasta: "2026-09",
  comparaciones: {
    ...RESPUESTA_EJEMPLO.comparaciones,
    periodoAnterior: { ...RESPUESTA_EJEMPLO.comparaciones.periodoAnterior!, desde: "2026-08", hasta: "2026-08" },
  },
};

beforeEach(() => {
  apiGet.mockReset();
  // Sólo el reloj: las esperas de findBy siguen con timers de verdad.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

it("pide el mes de hoy y muestra lo cobrado y la variación contra el mes pasado", async () => {
  apiGet.mockResolvedValue(SEPTIEMBRE);
  render(<TarjetaFinanzas />);
  const tarjeta = screen.getByRole("link", { name: /Finanzas del consultorio/ });
  expect(tarjeta.getAttribute("href")).toBe("/finanzas");
  await waitFor(() => expect(tarjeta.textContent).toContain("$ 5.100"));
  expect(tarjeta.textContent).toContain("Cobraste en septiembre $ 5.100 · + $ 3.900 (+325 %) contra agosto");
  expect(apiGet).toHaveBeenCalledWith("/api/finanzas/resumen?desde=2026-09&hasta=2026-09", expect.anything());
});

it("sin mes anterior con datos dice que no hay con qué comparar", async () => {
  apiGet.mockResolvedValue({
    ...SEPTIEMBRE,
    comparaciones: { periodoAnterior: null, mismoPeriodoAnioAnterior: null },
  });
  render(<TarjetaFinanzas />);
  const tarjeta = screen.getByRole("link", { name: /Finanzas del consultorio/ });
  await waitFor(() => expect(tarjeta.textContent).toContain("Sin datos para comparar con agosto"));
});

it.each([
  ["si el pedido falla", () => apiGet.mockRejectedValue(new Error("red"))],
  ["si la respuesta no tiene la forma esperada", () => apiGet.mockResolvedValue({ ok: false })],
])("%s la tarjeta está igual, sin el número", async (_caso, preparar) => {
  preparar();
  render(<TarjetaFinanzas />);
  const tarjeta = screen.getByRole("link", { name: /Finanzas del consultorio/ });
  await waitFor(() => expect(apiGet).toHaveBeenCalled());
  await Promise.resolve();
  expect(tarjeta.textContent).toContain(FINANZAS_TARJETA_SIN_DATO);
  expect(tarjeta.textContent).not.toContain("$");
});

it("los meses que nombra son los de la respuesta, no los del reloj del teléfono", async () => {
  // El teléfono cree que es octubre; el servidor contestó septiembre.
  vi.setSystemTime(new Date("2026-10-02T15:00:00Z"));
  apiGet.mockResolvedValue(SEPTIEMBRE);
  render(<TarjetaFinanzas />);
  const tarjeta = screen.getByRole("link", { name: /Finanzas del consultorio/ });
  await waitFor(() => expect(tarjeta.textContent).toContain("Cobraste en septiembre"));
  expect(tarjeta.textContent).toContain("contra agosto");
});

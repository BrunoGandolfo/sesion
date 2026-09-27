// @vitest-environment jsdom
// Una barra por período; tocarla abre el detalle de ESE período.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";

import { FinanzasView } from "../finanzas-view";
import { RESPUESTA_EJEMPLO } from "./respuesta-ejemplo";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet,
}));

const COBRO_AGOSTO = {
  id: "t1",
  fecha: "2026-08-05T15:00:00Z",
  pagoFecha: "2026-08-05T15:00:00Z",
  pagoMetodo: "efectivo",
  tarifaCobrada: 1200,
  paciente: { id: "p1", nombre: "Ana", apellido: "Pérez" },
};

function responder(resumen: ResumenFinanzas) {
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/finanzas/resumen")) return resumen;
    if (url === "/api/turnos/cobros?mes=2026-08") return [COBRO_AGOSTO];
    throw new Error(`pedido inesperado: ${url}`);
  });
}

beforeEach(() => {
  apiGet.mockReset();
});

it("dibuja una barra por entrada de la serie, con lo que dice su dibujo en palabras", async () => {
  responder(RESPUESTA_EJEMPLO);
  render(<FinanzasView />);
  const barras = await screen.findAllByRole("button", { name: /Ver el detalle\.$/ });
  expect(barras.map((b) => b.getAttribute("data-clave"))).toEqual(["2026-08", "2026-09"]);
  expect(barras[0].getAttribute("aria-label")).toBe(
    "agosto 2026: trabajaste $ 3.600; ya cobrado $ 2.400, falta cobrar $ 1.200. Ver el detalle.",
  );
  expect(screen.getByRole("heading", { name: "Mes a mes" })).toBeTruthy();
});

it("tocar la barra de agosto abre agosto: sus números y lo que entró ese mes", async () => {
  responder(RESPUESTA_EJEMPLO);
  render(<FinanzasView />);
  const [agosto] = await screen.findAllByRole("button", { name: /Ver el detalle\.$/ });
  fireEvent.click(agosto);

  const sheet = await screen.findByRole("dialog", { name: "Agosto 2026" });
  const numeros = Object.fromEntries(
    Array.from(sheet.querySelectorAll("dl > div")).map((d) => [
      d.querySelector("dt")!.firstChild!.textContent,
      d.querySelector("dd")!.textContent,
    ]),
  );
  expect(numeros).toEqual({
    "Lo que entró": "$ 1.200",
    "Lo que trabajaste": "$ 3.600",
    "Ya cobrado": "$ 2.400",
    "Falta cobrar": "$ 1.200",
    Pacientes: "2",
    "Tarifa promedio": "$ 1.200",
  });
  expect(apiGet).toHaveBeenCalledWith("/api/turnos/cobros?mes=2026-08", expect.anything());
  const fila = (await within(sheet).findByRole("link", { name: "Ana Pérez" })).closest("li")!;
  expect(fila.textContent).toContain("$ 1.200");
  expect(fila.textContent).toContain("Efectivo");

  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("con granularidad año el detalle trae sólo los números, sin pedir cobros", async () => {
  const [agosto] = RESPUESTA_EJEMPLO.serie;
  responder({
    ...RESPUESTA_EJEMPLO,
    granularidad: "anio",
    serie: [{ ...agosto, clave: "2026", mes: null }],
  });
  render(<FinanzasView />);
  expect(await screen.findByRole("heading", { name: "Año a año" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^2026: / }));
  const sheet = await screen.findByRole("dialog", { name: "2026" });
  expect(sheet.textContent).toContain("$ 3.600");
  expect(within(sheet).queryByRole("heading", { level: 3 })).toBeNull();
  expect(apiGet.mock.calls.every(([url]) => !String(url).startsWith("/api/turnos/cobros"))).toBe(true);
});

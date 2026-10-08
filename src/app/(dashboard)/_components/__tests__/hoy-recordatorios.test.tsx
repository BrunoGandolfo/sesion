// @vitest-environment jsdom
// Hoy dibuja "Recordatorios para hoy" después de la agenda del día, y con SMS
// automático no queda ni el bloque ni su hueco en la cascada.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { Dashboard } from "../dashboard";
import { leerHoy, SIN_PENDIENTES } from "../datos";
import { relojFijo } from "./reloj-fijo";

relojFijo(new Date("2026-10-08T15:00:00Z"));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../datos", async (original) => ({ ...(await original<typeof import("../datos")>()), leerHoy: vi.fn() }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

afterEach(cleanup);

function hoyVacio() {
  vi.mocked(leerHoy).mockResolvedValue({
    nombre: null,
    ahora: new Date("2026-10-08T15:00:00Z"),
    riesgoEnElDia: false,
    data: {
      inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: 0, deudaAcumulada: 0, ingresosMes: 0 },
      sesionesHoy: [],
      deudores: [],
      proximaSesion: null,
      riesgoDelDia: [],
      pendientes: SIN_PENDIENTES,
    },
  });
}

it("con WhatsApp, el bloque va después de la agenda del día", async () => {
  hoyVacio();
  api.get.mockResolvedValue({ canal: "whatsapp", turnos: [] });
  render(<Dashboard />);
  const agenda = await screen.findByText("Agenda del día");
  const bloque = await screen.findByRole("region", { name: "Recordatorios para hoy" });
  expect(agenda.compareDocumentPosition(bloque) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("No hay turnos para avisar hoy")).toBeTruthy();
});

it("con SMS no hay bloque ni envoltura visible", async () => {
  hoyVacio();
  api.get.mockResolvedValue({ canal: "sms", turnos: [] });
  render(<Dashboard />);
  await screen.findByText("Agenda del día");
  await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/recordatorios/whatsapp", expect.anything()));
  expect(screen.queryByText("Recordatorios para hoy")).toBeNull();
  // La cascada lleva la regla que oculta las envolturas vacías.
  const cascada = screen.getByText("Agenda del día").closest("section")!.parentElement!.parentElement!;
  expect(cascada.className).toContain("[&>:empty]:hidden");
  const vacias = Array.from(cascada.children).filter((hijo) => hijo.childNodes.length === 0);
  expect(vacias.length).toBeGreaterThan(0);
});

// @vitest-environment jsdom

// El sheet de agendar de Hoy y de la Agenda: la lista de pacientes no queda
// vacía para siempre si la primera lectura falla, y cada apertura lee de
// nuevo (una paciente creada desde el formulario aparece la próxima vez).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { AGENDAR_TURNO, PACIENTES_NO_CARGARON, REINTENTAR } from "@/lib/glosario";

import { SheetNuevoTurno } from "../sheet-nuevo-turno";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: vi.fn(),
}));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const ANA = {
  id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222", activo: true,
  organizationId: "org", tarifaDefault: null, creadoEn: "2026-09-01T00:00:00.000Z",
  actualizadoEn: "2026-09-01T00:00:00.000Z", ultimaSesion: null, deudaTotal: 0,
};

beforeEach(() => {
  api.get.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

it("si la lista no llega, lo dice y Reintentar la vuelve a pedir", async () => {
  let pacientes = 0;
  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/config") return { tarifaDefault: 1500 };
    pacientes += 1;
    if (pacientes === 1) throw new Error("sin red");
    return [ANA];
  });
  render(<SheetNuevoTurno open onClose={vi.fn()} onSubmit={vi.fn()} />);

  expect(await screen.findByText(PACIENTES_NO_CARGARON[0])).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));

  await screen.findByRole("button", { name: "Agendar" });
  expect(pacientes).toBe(2);
});

it("cada apertura lee de nuevo la lista", async () => {
  api.get.mockImplementation(async (url: string) => (url === "/api/config" ? null : [ANA]));
  const props = { onClose: vi.fn(), onSubmit: vi.fn() };
  const { rerender } = render(<SheetNuevoTurno open {...props} />);
  expect(await screen.findByRole("dialog", { name: AGENDAR_TURNO })).toBeTruthy();
  await screen.findByRole("button", { name: "Agendar" });

  rerender(<SheetNuevoTurno open={false} {...props} />);
  rerender(<SheetNuevoTurno open {...props} />);
  await waitFor(() =>
    expect(api.get.mock.calls.filter(([url]) => url === "/api/pacientes")).toHaveLength(2),
  );
});

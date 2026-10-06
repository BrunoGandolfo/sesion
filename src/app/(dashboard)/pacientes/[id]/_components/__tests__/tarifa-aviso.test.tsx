// @vitest-environment jsdom
//
// Al guardar la ficha con la tarifa cambiada, el aviso dice cuántos turnos
// futuros reescribió el servidor (PATCH /api/pacientes/[id] →
// turnosActualizados). Si el campo no viene —la ruta todavía no lo manda— o
// es 0, el aviso es el de siempre.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { avisoAlGuardar } from "../editar-paciente-form";
import { PacienteDetailView } from "../paciente-detail-view";

const m = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pacientes/p1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPatch: m.patch,
  apiGet: async (url: string) => {
    if (url === "/api/pacientes/p1") {
      return {
        paciente: { id: "p1", nombre: "Paciente", apellido: "Sintética", telefono: "+59899000000", tarifa: 2200, notas: null, activo: true,
          creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", ultimaSesion: null, deudaTotal: 0 },
        turnos: [],
      };
    }
    return null;
  },
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, ariaLabel, children }: { open: boolean; ariaLabel: string; children: ReactNode }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));
vi.mock("@/hooks/useGrabacionSesion", () => ({ useGrabacionSesion: () => ({ sesionClinica: null, loading: false }) }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../sesiones-tab", () => ({ SesionesTab: () => null }));
vi.mock("../recorrido-tab", () => ({ RecorridoTab: () => null }));
vi.mock("../ficha-tab", () => ({ FichaTab: () => null }));

beforeEach(() => {
  m.patch.mockReset();
  window.history.replaceState(null, "", "/pacientes/p1");
});
afterEach(cleanup);

async function guardarConTarifa(tarifa: number) {
  render(<PacienteDetailView id="p1" />);
  fireEvent.click(await screen.findByRole("button", { name: /Editar datos/ }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: String(tarifa) } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(m.patch).toHaveBeenCalled());
}

it("con turnos futuros actualizados, el aviso dice cuántos", async () => {
  m.patch.mockResolvedValue({ id: "p1", turnosActualizados: 3 });
  await guardarConTarifa(2500);
  expect(await screen.findByText("Tarifa guardada. Se actualizaron 3 turnos futuros.")).toBeTruthy();
});

it.each([
  ["el campo es 0", { id: "p1", turnosActualizados: 0 }],
  ["el campo no viene", { id: "p1" }],
])("si %s, el aviso es el de siempre", async (_caso, respuesta) => {
  m.patch.mockResolvedValue(respuesta);
  await guardarConTarifa(2500);
  expect(await screen.findByText("Paciente actualizado")).toBeTruthy();
  expect(screen.queryByText(/Tarifa guardada/)).toBeNull();
});

it("sin cambiar la tarifa no habla de turnos aunque el servidor mande el número", () => {
  expect(avisoAlGuardar(false, { turnosActualizados: 4 })).toBe("Paciente actualizado");
});

it("uno solo va en singular y un valor que no es un entero positivo no se muestra", () => {
  expect(avisoAlGuardar(true, { turnosActualizados: 1 })).toBe("Tarifa guardada. Se actualizó 1 turno futuro.");
  expect(avisoAlGuardar(true, { turnosActualizados: "3" })).toBe("Paciente actualizado");
  expect(avisoAlGuardar(true, null)).toBe("Paciente actualizado");
});

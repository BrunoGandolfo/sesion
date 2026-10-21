// @vitest-environment jsdom
// Cancelar un turno desde el detalle: la confirmación habla del recordatorio
// por WhatsApp (el único que hay), con el texto del
// glosario, y recién el segundo toque cancela.
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnoDetailSheet } from "../turno-detail-sheet";
import { CANCELAR_TURNO_MENSAJE } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiGet: api.get, apiPatch: api.patch,
}));
vi.mock("@/components/clinico/brief-corto", () => ({ BriefCortoDePaciente: () => null }));
// La geometría de Sheet se prueba con navegador; acá alcanza con el contenido.
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(),
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
}));
const turno: TurnoConPaciente = {
  id: "turno-1", organizationId: "org", pacienteId: "p1",
  fecha: new Date("2026-10-01T15:00:00Z"), duracion: 50, modalidad: "presencial",
  estado: "programado", tarifaCobrada: 2000, pagoEstado: "pendiente",
  pagoFecha: null, pagoMetodo: null, notas: null, serieId: null,
  creadoEn: new Date(), actualizadoEn: new Date(), sesionClinica: null,
  paciente: { id: "p1", nombre: "Lucía", apellido: "Prueba", telefono: "+59899000000" },
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  vi.clearAllMocks();
  vi.stubGlobal("scrollTo", vi.fn());
  api.get.mockImplementation((ruta: string) => Promise.resolve(ruta.startsWith("/api/sesion-clinica") ? null : []));
  api.patch.mockResolvedValue({ ...turno, estado: "cancelado" });
});
afterEach(() => {
  vi.useRealTimers();
});

it("la confirmación habla del recordatorio por WhatsApp, no de SMS", async () => {
  await act(async () => {
    render(<TurnoDetailSheet open turno={turno} onClose={vi.fn()} onUpdated={vi.fn()} />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancelar turno" }));
  const confirmacion = screen.getByRole("alertdialog");
  expect(confirmacion.textContent).toContain(CANCELAR_TURNO_MENSAJE);
  expect(CANCELAR_TURNO_MENSAJE).toMatch(/WhatsApp/);
  expect(confirmacion.textContent).not.toMatch(/SMS/);
  expect(api.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el turno" }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/api/turnos/turno-1", { estado: "cancelado" }));
});

// @vitest-environment jsdom
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TurnoDetailSheet } from "../turno-detail-sheet";
import { ApiClientError } from "@/lib/api-client";
import type { TurnoConPaciente } from "@/types/domain";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiGet: api.get, apiPost: api.post,
}));
vi.mock("@/components/clinico/brief-corto", () => ({ BriefCortoDePaciente: () => null }));
// La geometría de Sheet se prueba con navegador; acá se usa una sola copia
// del contenido para verificar las acciones de la usuaria.
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(),
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
}));
const turno: TurnoConPaciente = {
  id: "turno-serie", organizationId: "org", pacienteId: "p1",
  fecha: new Date("2026-10-01T15:00:00Z"), duracion: 50, modalidad: "presencial",
  estado: "programado", tarifaCobrada: 2000, pagoEstado: "pendiente",
  pagoFecha: null, pagoMetodo: null, notas: null, serieId: "s1",
  creadoEn: new Date(), actualizadoEn: new Date(), sesionClinica: null,
  paciente: { id: "p1", nombre: "Lucía", apellido: "Prueba", telefono: "+59899000000" },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("scrollTo", vi.fn());
  api.get.mockImplementation((ruta: string) => Promise.resolve(ruta.startsWith("/api/sesion-clinica") ? null : []));
  api.post.mockResolvedValue({ cancelados: 5 });
});
async function montar(datos = turno) {
  const onUpdated = vi.fn();
  await act(async () => { render(<TurnoDetailSheet open turno={datos} onClose={vi.fn()} onUpdated={onUpdated} />); });
  return { onUpdated };
}
it("desde el detalle, dos toques confirman la cancelación del resto con el contrato vigente", async () => {
  const { onUpdated } = await montar();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el resto de la serie" }));
  expect(screen.getByRole("alertdialog").textContent).toContain("Los ya realizados y los anteriores quedan como están");
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el resto" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/turnos/turno-serie/cancelar-serie", {}));
  expect(onUpdated).toHaveBeenCalledWith("Se cancelaron 5 turnos de la serie");
});
it("volver de la confirmación no cancela ningún turno", async () => {
  await montar();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el resto de la serie" }));
  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancelar el resto de la serie" })).toBeTruthy();
});
it("no ofrece cancelar una serie en un turno único", async () => {
  await montar({ ...turno, serieId: null });
  expect(screen.queryByRole("button", { name: "Cancelar el resto de la serie" })).toBeNull();
});
it("un error real del servidor no se presenta como una cancelación exitosa", async () => {
  api.post.mockRejectedValue(new ApiClientError("No se pudo cancelar la serie", 503));
  const { onUpdated } = await montar();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el resto de la serie" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar el resto" }));
  // Una sola vez y en línea: el detalle ya no manda el error hacia arriba
  // para que la pantalla lo repita como toast.
  const avisos = await screen.findAllByRole("alert");
  expect(avisos).toHaveLength(1);
  expect(avisos[0].textContent).toBe("No se pudo cancelar la serie");
  expect(onUpdated).not.toHaveBeenCalled();
});

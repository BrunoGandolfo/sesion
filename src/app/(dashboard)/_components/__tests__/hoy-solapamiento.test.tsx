// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiClientError } from "@/lib/api-client";
import { NO_SE_PUDO_AGENDAR, TURNO_AGENDADO, TURNO_SOLAPADO } from "@/lib/glosario";
import { Dashboard } from "../dashboard";
import { leerHoy, SIN_PENDIENTES } from "../datos";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(), apiGet: api.get, apiPost: api.post,
}));
vi.mock("../datos", async (original) => ({
  ...await original<typeof import("../datos")>(), leerHoy: vi.fn(),
}));
vi.mock("framer-motion", async (original) => ({
  ...await original<typeof import("framer-motion")>(), useReducedMotion: () => true,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children, ariaLabel }: { open: boolean; children: ReactNode; ariaLabel: string }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));
vi.mock("../agenda-del-dia", () => ({
  AgendaDelDia: ({ onAgendar }: { onAgendar: () => void }) => <button onClick={onAgendar}>Agendar en Hoy</button>,
}));
// Se mantiene el sheet abierto/cerrado por el Dashboard real; el formulario
// entrega los mismos datos en cada intento para verificar que el rechazo
// no cierra la edición ni transforma el pedido. Como el formulario real,
// muestra el motivo del rechazo (ApiClientError.mensaje) en un alert.
vi.mock("../sheet-nuevo-turno", async () => {
  const React = await import("react");
  return {
    SheetNuevoTurno: ({ open, onSubmit }: { open: boolean; onSubmit: (d: NuevoTurnoData) => Promise<void> }) => {
      const [error, setError] = React.useState<string | null>(null);
      if (!open) return null;
      return (
        <div role="dialog" aria-label="Agendar">
          <button onClick={() => { setError(null); onSubmit(VALORES).catch((e: ApiClientError) => setError(e.mensaje)); }}>Guardar turno</button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      );
    },
  };
});
const VALORES: NuevoTurnoData = {
  pacienteId: "p1", fecha: "2026-09-10", hora: "12:00", duracion: 50, modalidad: "presencial", notas: "  consulta  ", frecuencia: "unico",
};
const PEDIDO = { pacienteId: "p1", fecha: "2026-09-10T15:00:00.000Z", duracion: 50, modalidad: "presencial", notas: "consulta", frecuencia: "unico" };
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue([]);
  api.post.mockResolvedValue({});
  vi.mocked(leerHoy).mockResolvedValue({
    nombre: null, ahora: new Date("2026-09-10T14:00:00Z"), riesgoEnElDia: false,
    data: { inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: 0, deudaAcumulada: 0, ingresosMes: 0 }, sesionesHoy: [],
      deudores: [], proximaSesion: null, riesgoDelDia: [], pendientes: SIN_PENDIENTES },
  });
});
async function guardar() {
  render(<Dashboard />);
  const abrir = await screen.findByRole("button", { name: "Agendar en Hoy" });
  await act(async () => { fireEvent.click(abrir); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar turno" })); });
}
describe("Hoy conserva el motivo del solapamiento", () => {
  it("muestra el conflicto en el formulario y permite repetir el mismo pedido", async () => {
    api.post.mockRejectedValueOnce(new ApiClientError(TURNO_SOLAPADO, 409));
    await guardar();
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toBe(TURNO_SOLAPADO);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Agendar" })).toBeTruthy();
    expect(api.post).toHaveBeenNthCalledWith(1, "/api/turnos", PEDIDO);
    expect(leerHoy).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar turno" })); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Agendar" })).toBeNull());
    expect(api.post).toHaveBeenNthCalledWith(2, "/api/turnos", PEDIDO);
    expect(screen.getByRole("status").textContent).toBe(TURNO_AGENDADO);
    expect(screen.getByRole("status").querySelector("svg")).toBeTruthy();
    expect(leerHoy).toHaveBeenCalledTimes(2);
  });
  it("un fallo que no viene de la API sale como aviso general, en el formulario", async () => {
    api.post.mockRejectedValue(new Error("Sin conexión"));
    await guardar();
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toBe(NO_SE_PUDO_AGENDAR);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Agendar" })).toBeTruthy();
    expect(leerHoy).toHaveBeenCalledTimes(1);
  });
  it("un rechazo de la API que no es conflicto muestra su motivo, como en la agenda", async () => {
    api.post.mockRejectedValue(new ApiClientError("Paciente no encontrado", 404));
    await guardar();
    expect((await screen.findByRole("alert")).textContent).toBe("Paciente no encontrado");
    expect(screen.getByRole("dialog", { name: "Agendar" })).toBeTruthy();
  });
});

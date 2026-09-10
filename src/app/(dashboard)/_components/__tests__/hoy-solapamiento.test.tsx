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
// no cierra la edición ni transforma el pedido.
vi.mock("../sheet-nuevo-turno", () => ({
  SheetNuevoTurno: ({ open, onSubmit }: { open: boolean; onSubmit: (d: NuevoTurnoData) => void }) =>
    open ? <div role="dialog" aria-label="Agendar"><button onClick={() => onSubmit(VALORES)}>Guardar turno</button></div> : null,
}));
const VALORES: NuevoTurnoData = {
  pacienteId: "p1", fecha: "2026-09-10", hora: "12:00", duracion: 50, modalidad: "presencial", notas: "  consulta  ",
};
const PEDIDO = { pacienteId: "p1", fecha: "2026-09-10T15:00:00.000Z", duracion: 50, modalidad: "presencial", notas: "consulta" };
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
  it("muestra el conflicto sin tilde y permite repetir el mismo pedido", async () => {
    api.post.mockRejectedValueOnce(new ApiClientError(TURNO_SOLAPADO, 409));
    await guardar();
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toBe(TURNO_SOLAPADO);
    expect(aviso.querySelector("svg")).toBeNull();
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
  it.each([new Error("Sin conexión"), new ApiClientError("Detalle interno", 500)])("conserva el aviso general si no es un conflicto: %s", async (error) => {
    api.post.mockRejectedValue(error);
    await guardar();
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toBe(NO_SE_PUDO_AGENDAR);
    expect(aviso.querySelector("svg")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Agendar" })).toBeTruthy();
  });
});

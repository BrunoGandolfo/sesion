// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TurnoConPaciente } from "@/types/domain";
import { NuevoPacienteForm } from "../pacientes/_components/nuevo-paciente-form";
import { TurnoDetailSheet } from "../agenda/_components/turno-detail-sheet";
import { RECORDATORIO_PENDIENTE, recordatorioAvisado } from "@/lib/glosario";
const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(), apiGet: m.get, apiPost: m.post,
}));
vi.mock("@/components/clinico/brief-corto", () => ({ BriefCortoDePaciente: () => null }));
vi.mock("framer-motion", async (original) => ({
  ...await original<typeof import("framer-motion")>(), useReducedMotion: () => true,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({open,children}: {open:boolean;children:ReactNode}) => open ? <div>{children}</div> : null,
}));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it("el alta ofrece y envía solo datos que el paciente puede guardar", async () => {
  const listo = vi.fn();
  m.post.mockResolvedValue({id:"p1"});
  render(<NuevoPacienteForm tarifaDefault={1500} onSuccess={listo} onCancel={vi.fn()} />);
  expect(screen.queryByLabelText(/email/i)).toBeNull();
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:"Ana"}});
  fireEvent.change(screen.getByLabelText("Apellido"), {target:{value:"Prueba"}});
  fireEvent.change(screen.getByLabelText("Teléfono"), {target:{value:"+59899111222"}});
  fireEvent.click(screen.getByRole("button", {name:"Crear paciente"}));
  await waitFor(() => expect(listo).toHaveBeenCalledWith({id:"p1"}));
  expect(m.post).toHaveBeenCalledWith("/api/pacientes", {
    nombre:"Ana",apellido:"Prueba",telefono:"+59899111222",tarifa:1500,notas:null,
  });
});
const fecha = new Date("2026-09-15T15:00:00Z");
const turno = {
  id:"t1",pacienteId:"p1",fecha,duracion:50,modalidad:"presencial",estado:"programado",
  tarifaCobrada:1500,pagoEstado:"pendiente",pagoFecha:null,pagoMetodo:null,notas:null,serieId:null,
  creadoEn:fecha,actualizadoEn:fecha,organizationId:"org",sesionClinica:null,
  paciente:{id:"p1",nombre:"Ana",apellido:"Prueba",telefono:"+59899111222"},
} satisfies TurnoConPaciente;
it.each([
  [null, RECORDATORIO_PENDIENTE],
  ["2026-09-14T22:10:00.000Z", recordatorioAvisado("14/09")],
])("el detalle muestra el aviso por WhatsApp del turno (%s), nunca un estado de SMS", async (avisadoEn, texto) => {
  m.get.mockImplementation(async (url:string) => {
    if(url === "/api/sesion-clinica?turnoId=t1") return null;
    if(url === "/api/recordatorios/whatsapp/t1") return { avisadoEn };
    throw Error("Ruta vieja: " + url);
  });
  render(<TurnoDetailSheet open turno={turno} onClose={vi.fn()} onUpdated={vi.fn()} />);
  expect(await screen.findByText(texto)).toBeTruthy();
  expect(screen.queryByText(/Cancelado|SMS|va por WhatsApp/)).toBeNull();
  expect(screen.queryByRole("button", {name:/reintentar/i})).toBeNull();
  expect(m.get).toHaveBeenCalledWith("/api/recordatorios/whatsapp/t1", expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it("reprogramar desde el detalle vuelve a leer el aviso: el de la fecha nueva está pendiente", async () => {
  m.get.mockImplementation(async (url:string) => {
    if(url === "/api/sesion-clinica?turnoId=t1") return null;
    if(url === "/api/recordatorios/whatsapp/t1") return { avisadoEn: m.get.mock.calls.filter(([u]) => u === url).length === 1 ? "2026-09-14T22:10:00.000Z" : null };
    throw Error("Ruta vieja: " + url);
  });
  const { rerender } = render(<TurnoDetailSheet open turno={turno} onClose={vi.fn()} onUpdated={vi.fn()} />);
  expect(await screen.findByText(recordatorioAvisado("14/09"))).toBeTruthy();
  rerender(<TurnoDetailSheet open turno={{ ...turno, fecha: new Date("2026-09-22T15:00:00Z") }} onClose={vi.fn()} onUpdated={vi.fn()} />);
  expect(await screen.findByText(RECORDATORIO_PENDIENTE)).toBeTruthy();
  expect(screen.queryByText(recordatorioAvisado("14/09"))).toBeNull();
});

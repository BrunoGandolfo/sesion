// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TurnoConPaciente } from "@/types/domain";
import { NuevoPacienteForm } from "../pacientes/_components/nuevo-paciente-form";
import { TurnoDetailSheet } from "../agenda/_components/turno-detail-sheet";
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
  ["pendiente","Programado"],["enviando","Enviando"],["aceptado","En camino"],
  ["entregado","Entregado"],["no_entregado","No llegó"],["cancelado","Cancelado"],
  ["fallido","No salió"],["desconocido","No sabemos si salió"],
])("el detalle lee el envío durable y muestra %s sin ofrecer reintento manual", async (estado, texto) => {
  m.get.mockImplementation(async (url:string) => {
    if(url === "/api/sesion-clinica?turnoId=t1") return null;
    if(url === "/api/sms/envios?turnoId=t1") return [{id:"sms1",estado,programadoEn:fecha.toISOString(),
      aceptadoEn:null,intentos:1,motivoNoEnvio:"Motivo informado por el proveedor"}];
    throw Error("Ruta vieja: " + url);
  });
  render(<TurnoDetailSheet open turno={turno} onClose={vi.fn()} onUpdated={vi.fn()} />);
  expect(await screen.findByText(texto)).toBeTruthy();
  expect(screen.getByText("Motivo informado por el proveedor")).toBeTruthy();
  expect(screen.queryByRole("button", {name:/reintentar/i})).toBeNull();
  expect(m.get).toHaveBeenCalledWith("/api/sms/envios?turnoId=t1", expect.objectContaining({signal:expect.any(AbortSignal)}));
});

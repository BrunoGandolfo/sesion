// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { DatosGrabacion } from "@/components/grabacion/GrabadorSesion";
import type { PacienteConDeuda, Turno } from "@/types/domain";
import { ApiClientError } from "@/lib/api-client";
import { COBRO_DESHECHO, SMS_ENVIADO } from "@/lib/glosario";

import { CobrosView } from "../cobros/_components/cobros-view";
import { GrabarView } from "../grabar/[turnoId]/_components/grabar-view";
import { PacientesView } from "../pacientes/_components/pacientes-view";
import { FichaTab } from "../pacientes/[id]/_components/ficha-tab";
import { TurnosPagosTab } from "../pacientes/[id]/_components/turnos-pagos-tab";
import { PacienteDetailView } from "../pacientes/[id]/_components/paciente-detail-view";
import { AgendaView } from "../agenda/_components/agenda-view";

const m = vi.hoisted(() => ({
  get: vi.fn<(url: string) => Promise<unknown>>(),
  post: vi.fn(), patch: vi.fn(), borrar: vi.fn(), subir: vi.fn(), iniciar: vi.fn(),
  router: { push: vi.fn() },
  grabador: null as null | { onError: (mensaje: string) => void; onListo: (datos: DatosGrabacion) => void },
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiGet: m.get, apiPost: m.post, apiPatch: m.patch, apiDelete: m.borrar,
}));
vi.mock("next/navigation", () => ({ useRouter: () => m.router, usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("framer-motion", async (original) => ({
  ...await original<typeof import("framer-motion")>(), useReducedMotion: () => true,
}));
// El layout responsive monta dos paneles en jsdom. Acá importan los eventos
// y el Toast real; no se simulan foco, tamaños ni animaciones del dispositivo.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, ariaLabel, children }: { open: boolean; ariaLabel: string; children: ReactNode }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null, AccesoConsultorio: () => null }));
vi.mock("@/components/grabacion/ConsentimientoBadge", () => ({ ConsentimientoBadge: () => null }));
vi.mock("@/components/grabacion/HotWordsManager", () => ({ HotWordsManager: () => null }));
vi.mock("../pacientes/[id]/_components/brief-pre-sesion", () => ({ BriefPreSesion: () => null }));
vi.mock("../pacientes/[id]/_components/recorrido-tab", () => ({ RecorridoTab: () => null }));
vi.mock("../pacientes/[id]/_components/cabecera-ficha", () => ({ CabeceraFicha: () => null, CabeceraNavegacionFicha: () => null }));
vi.mock("@/hooks/useHoy", () => ({ useHoy: () => AHORA }));
vi.mock("@/hooks/useGrabacionSesion", () => ({
  useGrabacionSesion: () => ({ sesionClinica: { id: "s1", estado: "aprobado" }, loading: false }),
  subirAudioCifrado: m.subir, volverAGrabando: vi.fn(), marcarTurnoRealizado: vi.fn(),
}));
vi.mock("@/lib/grabacion-storage", () => ({ limpiarGrabacion: vi.fn() }));
vi.mock("@/components/grabacion/GrabadorSesion", () => ({
  useGrabador: (opciones: NonNullable<typeof m.grabador>) => {
    m.grabador = opciones;
    return { estado: "inactivo", pendiente: null, iniciar: m.iniciar };
  },
  formatearDuracion: () => "00:00",
}));
// Se ejercita la conexión real entre el detalle de agenda y su aviso. Las
// operaciones del sheet tienen sus propias pruebas: acá inyectamos su resultado.
vi.mock("../agenda/_components/week-view", () => ({
  WeekView: ({ onEventClick }: { onEventClick: (turno: Turno) => void }) =>
    <button onClick={() => onEventClick(TURNO)}>Abrir turno de prueba</button>,
}));
vi.mock("../agenda/_components/turno-detail-sheet", () => ({
  TurnoDetailSheet: ({ open, onError, onUpdated }: { open: boolean; onError: (s: string) => void; onUpdated: (s: string) => void }) =>
    open ? <div><button onClick={() => onError(FALLO)}>Simular rechazo</button><button onClick={() => onUpdated("Turno actualizado")}>Simular confirmación</button></div> : null,
}));

const AHORA = new Date("2026-09-09T15:00:00.000Z");
const FALLO = "No se pudo completar la operación de prueba";
const PACIENTE: PacienteConDeuda = {
  id: "p1", nombre: "Paciente", apellido: "Sintética", telefono: "+59899111222",
  email: null, tarifa: 1500, notas: null, activo: false, creadoEn: AHORA,
  actualizadoEn: AHORA, organizationId: "test", sesionesRealizadas: 1,
  totalCobrado: 0, sesionesImpagas: 1, deudaTotal: 1500, ultimaSesion: AHORA,
};
const TURNO: Turno = {
  id: "t1", pacienteId: "p1", fecha: AHORA, duracion: 50, modalidad: "presencial",
  estado: "realizado", tarifaCobrada: 1500, pagoEstado: "pendiente", pagoFecha: null,
  pagoMetodo: null, notas: null, creadoEn: AHORA, actualizadoEn: AHORA, organizationId: "test",
};
function jsonTurno(pagado = false) {
  return { ...TURNO, fecha: AHORA.toISOString(), creadoEn: AHORA.toISOString(), actualizadoEn: AHORA.toISOString(),
    pagoEstado: pagado ? "pagado" : "pendiente", pagoFecha: pagado ? AHORA.toISOString() : null,
    pagoMetodo: pagado ? "efectivo" : null, paciente: PACIENTE, sesionClinica: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.grabador = null;
  m.post.mockResolvedValue(jsonTurno(true));
  m.patch.mockResolvedValue({});
  m.borrar.mockResolvedValue(jsonTurno());
  m.iniciar.mockResolvedValue(undefined);
  m.subir.mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  m.get.mockImplementation(async (url) => {
    if (url === "/api/config") return { nombreProfesional: "Prueba", tarifaDefault: 1500 };
    if (url === "/api/dashboard") return { kpis: { sesionesHoy: 0, deudaAcumulada: 1500, ingresosMes: 0 } };
    if (url === "/api/deudores") return [{ pacienteId: "p1", nombre: "Paciente", apellido: "Sintética", telefono: PACIENTE.telefono,
      minutosTotales: 50, ultimoAvisoEn: null, sesionesImpagas: 1, montoTotal: 1500, diasAtraso: 1 }];
    if (url === "/api/turnos/cobros") return [];
    if (url === "/api/sms/estado") return { ok: true };
    if (url.includes("/documentacion?")) return { sesiones: [], totalSesiones: 0, totalPages: 0, page: 1 };
    if (url.endsWith("/consentimiento")) return { consentimiento: null };
    if (url === "/api/pacientes/p1") return { paciente: PACIENTE, turnos: [jsonTurno()] };
    if (url.startsWith("/api/pacientes")) return [PACIENTE];
    if (url.startsWith("/api/turnos?")) return [jsonTurno()];
    if (url.startsWith("/api/sesion-clinica?")) return { id: "s1", estado: "grabando" };
    throw new Error(`Lectura inesperada: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function verificarAviso(mensaje: string, confirma: boolean) {
  await waitFor(() => {
    const aviso = screen.getAllByRole("status").find((nodo) => nodo.textContent === mensaje);
    expect(aviso, `Falta el aviso: ${mensaje}`).toBeTruthy();
    expect(Boolean(aviso?.querySelector("svg"))).toBe(confirma);
    expect(aviso?.getAttribute("aria-live")).toBe("polite");
  });
}
async function cobrar() {
  fireEvent.click(await screen.findByRole("button", { name: /^Cobrar/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Efectivo/ }));
}

describe("los avisos distinguen un rechazo de una operación confirmada", () => {
  it.each([false, true])("SMS de cobro: éxito=%s", async (exito) => {
    if (exito) m.post.mockResolvedValue({ enviadoEn: AHORA.toISOString() });
    else m.post.mockRejectedValue(new ApiClientError(FALLO, 502));
    render(<CobrosView />);
    fireEvent.click(await screen.findByRole("button", { name: /Recordar cobro a/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar SMS" }));
    await verificarAviso(exito ? SMS_ENVIADO : FALLO, exito);
    expect(m.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", {});
  });

  it.each([false, true])("reactivar desde la lista: éxito=%s", async (exito) => {
    if (!exito) m.patch.mockRejectedValue(new ApiClientError(FALLO, 500));
    render(<PacientesView />);
    fireEvent.click(screen.getByRole("tab", { name: "Archivados" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Reactivar" }))[0]);
    await verificarAviso(exito ? "Paciente reactivado" : FALLO, exito);
  });

  it.each([false, true])("reactivar desde la ficha: éxito=%s", async (exito) => {
    if (!exito) m.patch.mockRejectedValue(new Error(FALLO));
    render(<FichaTab paciente={PACIENTE} turnos={[]} config={null} reloadKey={0} onPacienteActualizado={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }));
    await verificarAviso(exito ? "Paciente reactivado" : FALLO, exito);
  });

  it("mantiene la confirmación al volver de archivar", async () => {
    render(<PacientesView archivedToast />);
    await verificarAviso("Paciente archivado", true);
  });

  it.each([false, true])("cobrar desde Turnos y pagos: éxito=%s", async (exito) => {
    if (!exito) m.post.mockRejectedValue(new Error(FALLO));
    render(<TurnosPagosTab turnos={[TURNO]} />);
    await cobrar();
    await verificarAviso(exito ? "Cobrado" : FALLO, exito);
  });

  it.each([false, true])("deshacer desde Turnos y pagos: éxito=%s", async (exito) => {
    if (!exito) m.borrar.mockRejectedValue(new Error(FALLO));
    render(<TurnosPagosTab turnos={[{ ...TURNO, pagoEstado: "pagado", pagoMetodo: "efectivo", pagoFecha: AHORA }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer cobro" }));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer el cobro" }));
    await verificarAviso(exito ? COBRO_DESHECHO : FALLO, exito);
  });

  it.each([false, true])("cobrar desde Sesiones comunica el resultado a la ficha: éxito=%s", async (exito) => {
    if (!exito) m.post.mockRejectedValue(new Error(FALLO));
    render(<PacienteDetailView id="p1" />);
    await cobrar();
    await verificarAviso(exito ? "Cobrado" : FALLO, exito);
  });

  it("agenda no celebra el error y sí la confirmación siguiente", async () => {
    render(<AgendaView />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir turno de prueba" }));
    fireEvent.click(screen.getByRole("button", { name: "Simular rechazo" }));
    await verificarAviso(FALLO, false);
    fireEvent.click(screen.getByRole("button", { name: "Simular confirmación" }));
    await verificarAviso("Turno actualizado", true);
  });

  it("la pantalla de grabar avisa un error y confirma solo la subida aceptada", async () => {
    render(<GrabarView turnoId="t1" turnoProgramado={false} horaTexto="12:00" pacienteId="p1" pacienteNombre="Paciente Sintética" autorizacionVigente />);
    act(() => m.grabador?.onError(FALLO));
    await verificarAviso(FALLO, false);
    fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
    await waitFor(() => expect(m.iniciar).toHaveBeenCalledWith("t1"));
    const datos: DatosGrabacion = { audioBlob: new Blob(["audio sintético"]), claveCifrado: "clave-de-prueba", ivCifrado: "iv-de-prueba", duracionSegundos: 5, pausas: [] };
    await act(async () => { m.grabador?.onListo(datos); });
    await verificarAviso("Te avisamos cuando la nota esté lista", true);
    expect(m.subir).toHaveBeenCalledWith("s1", datos, expect.any(Function));
  });

  it("un inicio rechazado no muestra una confirmación", async () => {
    m.get.mockRejectedValue(new Error(FALLO));
    render(<GrabarView turnoId="t1" turnoProgramado={false} horaTexto="12:00" pacienteId="p1" pacienteNombre="Paciente Sintética" autorizacionVigente />);
    fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
    await verificarAviso(FALLO, false);
    expect(m.iniciar).not.toHaveBeenCalled();
  });
});

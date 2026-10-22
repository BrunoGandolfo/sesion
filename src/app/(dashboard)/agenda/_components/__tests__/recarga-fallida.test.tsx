// @vitest-environment jsdom
//
// C1: después de cancelar (o cobrar, o reprogramar) la agenda se vuelve a
// pedir. Si esa lectura falla, la grilla no puede quedarse con el turno
// viejo sin decir nada: avisa que no está al día y ofrece reintentar.
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { lanzarSiNoOk } from "@/lib/api-client";
import { ALGO_FALLO, DATOS_SIN_ACTUALIZAR, ENTRAR, REINTENTAR, SESION_VENCIDA } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { AgendaView } from "../agenda-view";

const m = vi.hoisted(() => ({ get: vi.fn<(url: string) => Promise<unknown>>() }));

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPost: vi.fn(),
}));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));
// El detalle real es largo de manejar: alcanza con que avise "cancelado".
vi.mock("../turno-detail-sheet", () => ({
  TurnoDetailSheet: ({ open, onUpdated }: { open: boolean; onUpdated: (m: string) => void }) =>
    open ? <button onClick={() => onUpdated("Turno cancelado")}>simular cancelación</button> : null,
}));
// Miércoles 16 de septiembre de 2026, 12:00 de Montevideo. Una sola fecha,
// como la de verdad: un Date nuevo por render volvería a pedir el rango.
const HOY = new Date("2026-09-16T15:00:00.000Z");
vi.mock("@/hooks/useHoy", () => ({ useHoy: () => HOY }));

const LUCIA = {
  id: "a", pacienteId: "p-a", organizationId: "org", serieId: null, sesionClinica: null,
  fecha: "2026-09-16T13:00:00.000Z", duracion: 50, modalidad: "presencial", estado: "programado",
  tarifaCobrada: 2200, pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null, notas: null,
  creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z",
  paciente: { id: "p-a", nombre: "Lucía", apellido: "Prueba", telefono: "099" },
} as unknown as TurnoConPaciente;

/** Lo que devuelve fetch con la sesión vencida: el proxy redirige al login
 *  y fetch entrega su HTML con 200. lanzarSiNoOk lo convierte en el 401. */
async function errorDeSesionVencida(): Promise<unknown> {
  const res = new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "redirected", { value: true });
  Object.defineProperty(res, "url", { value: "http://localhost/login" });
  return lanzarSiNoOk(res).then(() => null, (err: unknown) => err);
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 1023px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

it("si falla la recarga tras cancelar, avisa y deja reintentar", async () => {
  let falla = false;
  m.get.mockImplementation(async (url: string) => {
    if (!url.startsWith("/api/turnos")) return [];
    if (falla) throw new TypeError("Failed to fetch");
    return [LUCIA];
  });
  render(<AgendaView />);
  const filas = await screen.findAllByText(/Lucía/);
  expect(screen.queryByText(DATOS_SIN_ACTUALIZAR)).toBeNull();

  falla = true;
  fireEvent.click(filas[filas.length - 1]!.closest("button, a, [role=button]") ?? filas[filas.length - 1]!);
  fireEvent.click(await screen.findByText("simular cancelación"));
  await act(async () => {});

  const aviso = await screen.findByRole("alert");
  expect(aviso.textContent).toContain(DATOS_SIN_ACTUALIZAR);

  falla = false;
  fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
  await act(async () => {});
  expect(screen.queryByText(DATOS_SIN_ACTUALIZAR)).toBeNull();
});

it("si la recarga vuelve con la sesión vencida, dice eso y no \"No se pudo actualizar\"", async () => {
  const vencida = await errorDeSesionVencida();
  let falla = false;
  m.get.mockImplementation(async (url: string) => {
    if (!url.startsWith("/api/turnos")) return [];
    if (falla) throw vencida;
    return [LUCIA];
  });
  render(<AgendaView />);
  const filas = await screen.findAllByText(/Lucía/);

  falla = true;
  fireEvent.click(filas[filas.length - 1]!.closest("button, a, [role=button]") ?? filas[filas.length - 1]!);
  fireEvent.click(await screen.findByText("simular cancelación"));
  await act(async () => {});

  const aviso = await screen.findByRole("alert");
  expect(aviso.textContent).toContain(SESION_VENCIDA);
  expect(aviso.textContent).not.toContain(DATOS_SIN_ACTUALIZAR);
  expect(screen.getByRole("link", { name: ENTRAR }).getAttribute("href")).toBe("/login?sesion=vencida");
});

it("si la primera lectura vuelve con la sesión vencida, dice eso y no \"Algo falló\"", async () => {
  const vencida = await errorDeSesionVencida();
  m.get.mockImplementation(async (url: string) => {
    if (!url.startsWith("/api/turnos")) return [];
    throw vencida;
  });
  render(<AgendaView />);
  expect((await screen.findByRole("alert")).textContent).toContain(SESION_VENCIDA);
  expect(screen.queryByText(ALGO_FALLO)).toBeNull();
});

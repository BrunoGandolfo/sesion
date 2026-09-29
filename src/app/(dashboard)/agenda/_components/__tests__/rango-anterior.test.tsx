// @vitest-environment jsdom
//
// Al cambiar de semana, los turnos de la semana anterior no se dibujan como
// si fueran los de la nueva: el día elegido no dice "Nada agendado" mientras
// la semana nueva todavía no llegó.
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { AGENDA_DIA_VACIO_TITULO } from "@/lib/glosario";
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
vi.mock("../turno-detail-sheet", () => ({ TurnoDetailSheet: () => null }));
// Miércoles 16 de septiembre de 2026, 12:00 de Montevideo.
vi.mock("@/hooks/useHoy", () => ({ useHoy: () => new Date("2026-09-16T15:00:00.000Z") }));

const LUCIA = {
  id: "a", pacienteId: "p-a", organizationId: "org", serieId: null, sesionClinica: null,
  fecha: "2026-09-16T13:00:00.000Z", duracion: 50, modalidad: "presencial", estado: "programado",
  tarifaCobrada: 2200, pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null, notas: null,
  creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z",
  paciente: { id: "p-a", nombre: "Lucía", apellido: "Prueba", telefono: "099" },
} as unknown as TurnoConPaciente;

beforeEach(() => {
  // En el teléfono: la agenda es un día.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 1023px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

it("mientras llega la semana siguiente, el día nuevo no dice que no hay turnos", async () => {
  let entregarLaSiguiente: (turnos: unknown[]) => void = () => {};
  m.get.mockImplementation(async (url: string) => {
    if (!url.startsWith("/api/turnos")) return [];
    if (url.includes("2026-09-14")) return [LUCIA];
    return new Promise((resolver) => { entregarLaSiguiente = resolver; });
  });
  render(<AgendaView />);
  expect((await screen.findAllByText(/Lucía/)).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await act(async () => {});

  expect(screen.queryByText(AGENDA_DIA_VACIO_TITULO)).toBeNull();
  expect(screen.queryAllByText(/Lucía/)).toHaveLength(0);

  await act(async () => entregarLaSiguiente([]));
  expect(await screen.findByText(AGENDA_DIA_VACIO_TITULO)).toBeTruthy();
});

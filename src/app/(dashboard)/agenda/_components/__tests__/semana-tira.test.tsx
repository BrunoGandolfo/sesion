// @vitest-environment jsdom
//
// En el teléfono, con el mes plegado, debajo del título va la semana del día
// elegido: siete días tocables con sus puntos. La tira pide los turnos de
// esa semana, no del mes entero; el mes sigue detrás del chevron.
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

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

function turno(id: string, nombre: string, fechaIso: string, pagoEstado = "pendiente") {
  return {
    id, pacienteId: `p-${id}`, organizationId: "org", serieId: null, sesionClinica: null,
    fecha: fechaIso, duracion: 50, modalidad: "presencial", estado: "programado",
    tarifaCobrada: 2200, pagoEstado, pagoMetodo: null, pagoFecha: null, notas: null,
    creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z",
    paciente: { id: `p-${id}`, nombre, apellido: "Prueba", telefono: "099" },
  } as unknown as TurnoConPaciente;
}

// Miércoles 16: Lucía. Viernes 18: Mercedes y dos más.
const SEMANA = [
  turno("a", "Lucía", "2026-09-16T13:00:00.000Z"),
  turno("b", "Mercedes", "2026-09-18T13:00:00.000Z", "pagado"),
  turno("c", "Rosa", "2026-09-18T15:00:00.000Z"),
  turno("d", "Inés", "2026-09-18T17:00:00.000Z"),
];

function urlsPedidas() {
  return m.get.mock.calls.map(([url]) => url).filter((u) => u.startsWith("/api/turnos"));
}

function rango(url: string) {
  const p = new URL(url, "http://x").searchParams;
  return { desde: p.get("desde"), hasta: p.get("hasta") };
}

beforeEach(() => {
  m.get.mockReset().mockImplementation(async (url: string) => (url.startsWith("/api/turnos") ? SEMANA : []));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 1023px)",
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});

it("a 390 px con el mes plegado muestra la tira de la semana, con sus puntos, y pide sólo esa semana", async () => {
  render(<AgendaView />);

  const tira = await screen.findByRole("group", { name: "Días de la semana" });
  const dias = within(tira).getAllByRole("button");
  expect(dias).toHaveLength(7);
  expect(dias.map((d) => d.textContent?.slice(0, 1)).join("")).toBe("LMMJVSD");

  // Lunes 14 a domingo 20 de Montevideo, no el mes entero.
  await waitFor(() => expect(urlsPedidas()).toHaveLength(1));
  expect(rango(urlsPedidas()[0])).toEqual({
    desde: "2026-09-14T03:00:00.000Z",
    hasta: "2026-09-21T02:59:59.999Z",
  });

  const viernes = await within(tira).findByRole("button", { name: /viernes 18 de septiembre: 3 turnos/ });
  await waitFor(() => expect(viernes.querySelectorAll("[data-punto]")).toHaveLength(3));
  const miercoles = within(tira).getByRole("button", { name: /miércoles 16 de septiembre: 1 turno$/ });
  expect(miercoles.getAttribute("aria-pressed")).toBe("true");
  expect(miercoles.querySelectorAll("[data-punto]")).toHaveLength(1);

  // El mes sigue detrás del chevron.
  expect(document.getElementById("agenda-mes-mobile")).toBeNull();
  const chevron = document.querySelector<HTMLButtonElement>('button[aria-controls="agenda-mes-mobile"]');
  expect(chevron?.getAttribute("aria-expanded")).toBe("false");
});

it("tocar otro día de la tira cambia la lista sin volver a pedir la semana", async () => {
  render(<AgendaView />);

  expect(await screen.findByRole("link", { name: /Lucía Prueba/ })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Mercedes Prueba/ })).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: /viernes 18 de septiembre: 3 turnos/ }));

  expect(await screen.findByRole("link", { name: /Mercedes Prueba/ })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Lucía Prueba/ })).toBeNull();
  const tira = screen.getByRole("group", { name: "Días de la semana" });
  expect(
    within(tira).getByRole("button", { name: /viernes 18 de septiembre/ }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(urlsPedidas()).toHaveLength(1);
});

it("las flechas mueven la tira de a una semana y el chevron despliega el mes", async () => {
  render(<AgendaView />);
  await screen.findByRole("group", { name: "Días de la semana" });

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() => expect(urlsPedidas()).toHaveLength(2));
  expect(rango(urlsPedidas()[1]).desde).toBe("2026-09-21T03:00:00.000Z");
  const tira = screen.getByRole("group", { name: "Días de la semana" });
  expect(
    within(tira).getByRole("button", { name: /miércoles 23 de septiembre/ }).getAttribute("aria-pressed"),
  ).toBe("true");

  const chevron = document.querySelector<HTMLButtonElement>('button[aria-controls="agenda-mes-mobile"]')!;
  fireEvent.click(chevron);
  expect(document.getElementById("agenda-mes-mobile")).not.toBeNull();
  expect(screen.queryByRole("group", { name: "Días de la semana" })).toBeNull();
});

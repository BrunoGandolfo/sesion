// @vitest-environment jsdom
//
// Hoy con la pantalla abierta: el reloj avanza (al llegar la hora de un
// turno aparece Cobrar), la tarjeta grande no es para quien no vino, y una
// recarga que falla se dice sin tirar lo que ya estaba en pantalla.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DATOS_SIN_ACTUALIZAR, REINTENTAR } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { Dashboard } from "../dashboard";
import { leerHoy, SIN_PENDIENTES, type EstadoHoy } from "../datos";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../datos", async (original) => ({
  ...(await original<typeof import("../datos")>()),
  leerHoy: vi.fn(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: vi.fn().mockResolvedValue(null),
  apiPost: vi.fn(),
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

// 10:59:30 en Montevideo; el turno es a las 11:00.
const ANTES = new Date("2026-09-11T13:59:30Z");
const A_LAS_ONCE = new Date("2026-09-11T14:00:00Z");

function turno(extra: Partial<TurnoConPaciente> = {}): TurnoConPaciente {
  return {
    id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
    fecha: A_LAS_ONCE, duracion: 50, modalidad: "presencial",
    estado: "programado", tarifaCobrada: 2200, pagoEstado: "pendiente", pagoFecha: null,
    pagoMetodo: null, notas: null, creadoEn: ANTES, actualizadoEn: ANTES, sesionClinica: null,
    paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222" },
    ...extra,
  };
}

function hoy(sesionesHoy: TurnoConPaciente[]): EstadoHoy {
  return {
    nombre: null, ahora: new Date(), riesgoEnElDia: false,
    data: {
      inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: sesionesHoy.length, deudaAcumulada: 0, ingresosMes: 0 },
      sesionesHoy, deudores: [], proximaSesion: null, riesgoDelDia: [],
      pendientes: SIN_PENDIENTES,
    },
  };
}

const botonesCobrar = () => screen.queryAllByRole("button", { name: /^Cobrar/ });

async function esperar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  vi.setSystemTime(ANTES);
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(leerHoy).mockReset();
});

it("con Hoy abierto, al llegar la hora del turno aparece Cobrar sin recargar", async () => {
  vi.mocked(leerHoy).mockImplementation(async () => hoy([turno()]));
  render(<Dashboard />);
  await esperar(0);
  expect(screen.getByRole("heading", { name: "Ana López" })).toBeTruthy();
  expect(botonesCobrar()).toHaveLength(0);

  await esperar(30_000);

  expect(botonesCobrar().length).toBeGreaterThan(0);
  expect(leerHoy).toHaveBeenCalledTimes(1);
});

it("pasada la medianoche vuelve a leer el día", async () => {
  vi.setSystemTime(new Date("2026-09-12T02:59:30Z")); // 23:59:30 en Montevideo
  vi.mocked(leerHoy).mockImplementation(async () => hoy([]));
  render(<Dashboard />);
  await esperar(0);
  expect(leerHoy).toHaveBeenCalledTimes(1);

  await esperar(30_000);
  expect(leerHoy).toHaveBeenCalledTimes(2);
});

it("la tarjeta grande no es para una paciente marcada No vino: pasa a la que sigue", async () => {
  vi.setSystemTime(new Date("2026-09-11T14:10:00Z"));
  const ausente = turno({ estado: "ausente" });
  const siguiente = turno({
    id: "t2", pacienteId: "p2", fecha: new Date("2026-09-11T15:00:00Z"),
    paciente: { id: "p2", nombre: "Bruno", apellido: "Díaz", telefono: "099333444" },
  });
  vi.mocked(leerHoy).mockImplementation(async () => hoy([ausente, siguiente]));
  render(<Dashboard />);
  await esperar(0);

  expect(screen.getByRole("heading", { name: "Bruno Díaz" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Ana López" })).toBeNull();
});

it("si una recarga falla, lo dice arriba y deja lo que estaba; Reintentar vuelve a leer", async () => {
  vi.mocked(leerHoy).mockImplementationOnce(async () => hoy([turno()]));
  render(<Dashboard />);
  await esperar(0);

  vi.mocked(leerHoy).mockRejectedValueOnce(new Error("sin red"));
  // Volver a la pestaña relee.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await esperar(0);

  expect(screen.getByRole("alert").textContent).toContain(DATOS_SIN_ACTUALIZAR);
  expect(screen.getByRole("heading", { name: "Ana López" })).toBeTruthy();

  vi.mocked(leerHoy).mockImplementationOnce(async () => hoy([turno()]));
  fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
  await esperar(0);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(leerHoy).toHaveBeenCalledTimes(3);
});

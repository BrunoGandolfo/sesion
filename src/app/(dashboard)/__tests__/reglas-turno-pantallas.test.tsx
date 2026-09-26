// @vitest-environment jsdom
//
// Las pantallas ofrecen Cobrar y Grabar con la MISMA regla con que el
// servidor los acepta (sePuedeCobrar, sePuedeGrabar de domain.ts). Antes el
// detalle de Agenda ofrecía Cobrar a un turno programado de más tarde, y
// ella tocaba y recibía un error: el servidor (casos-uso/cobrar-turno.ts)
// contesta 400 a un programado cuya hora no llegó. Y la hoja dejaba grabar
// un turno de ayer.
//
// Cada pantalla que decide mostrar Cobrar se monta con todas las
// combinaciones de estado, pago y hora, y tiene que mostrarlo exactamente
// donde sePuedeCobrar dice que sí. Como el servidor decide con esa misma
// función, "no se muestra donde el servidor contesta 400" queda probado por
// construcción (el lado del servidor está en cobrar-turno.test.ts).
//
// "Ahora" son las 15:20 del 23 de septiembre en Montevideo (18:20Z).
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sePuedeCobrar } from "@/app/api/_lib/domain";
import { SessionRow } from "@/components/ui/session-row";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import { GRABAR_SESION } from "@/lib/glosario";
import type { DashboardData, PagoEstado, TurnoConPaciente, TurnoEstado } from "@/types/domain";

import { CardAhora } from "../_components/card-ahora";
import { repartirElDia } from "../_components/datos";
import { TurnoDetailSheet } from "../agenda/_components/turno-detail-sheet";
import { SesionesTab } from "../pacientes/[id]/_components/sesiones-tab";
import { TurnosPagosTab } from "../pacientes/[id]/_components/turnos-pagos-tab";

const api = vi.hoisted(() => ({ get: vi.fn<(url: string) => Promise<unknown>>() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get, apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));
vi.mock("@/components/clinico/brief-corto", () => ({ BriefCortoDePaciente: () => null, BriefCorto: () => null }));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("@/components/ui")>()),
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const AHORA = new Date("2026-09-23T18:20:00.000Z");
const PASADO = new Date("2026-09-23T18:00:00.000Z"); // 15:00, empezó hace 20 min
const FUTURO = new Date("2026-09-23T19:00:00.000Z"); // 16:00, todavía no
const AYER = new Date("2026-09-22T18:00:00.000Z");

function turno(cambios: Partial<TurnoConPaciente> = {}): TurnoConPaciente {
  return {
    id: "t1", serieId: null, pacienteId: "p1", organizationId: "org",
    fecha: PASADO, duracion: 50, modalidad: "presencial", estado: "programado",
    tarifaCobrada: 2200, pagoEstado: "pendiente", pagoFecha: null, pagoMetodo: null,
    notas: null, creadoEn: AYER, actualizadoEn: AYER, sesionClinica: null,
    paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099123456" },
    ...cambios,
  };
}

const ESTADOS: TurnoEstado[] = ["programado", "realizado", "cancelado", "ausente"];
const PAGOS: PagoEstado[] = ["pendiente", "pagado"];
const HORAS = [["pasada", PASADO], ["futura", FUTURO]] as const;

/** Todas las combinaciones, con lo que dice la regla del servidor. */
const MATRIZ = ESTADOS.flatMap((estado) =>
  PAGOS.flatMap((pagoEstado) =>
    HORAS.map(([nombre, fecha]) => {
      const t = turno({ estado, pagoEstado, fecha });
      return { caso: `${estado}, ${pagoEstado}, hora ${nombre}`, t, cobrable: sePuedeCobrar(t, AHORA) };
    }),
  ),
);
/** Las pantallas de la ficha solo reciben turnos vivos como turno de hoy. */
const MATRIZ_VIVOS = MATRIZ.filter(({ t }) => t.estado === "programado" || t.estado === "realizado");

const botonCobrar = () => screen.queryByRole("button", { name: "Cobrar" });
const enlaceGrabar = () => screen.queryByRole("link", { name: GRABAR_SESION });
const botonGrabar = () => screen.queryByRole("button", { name: GRABAR_SESION });

beforeEach(() => {
  // Solo el reloj: las pantallas que no reciben `ahora` leen new Date().
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  api.get.mockReset();
  api.get.mockImplementation(async () => null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("la matriz tiene de los dos lados: turnos que se cobran y turnos que no", () => {
  expect(MATRIZ.some((m) => m.cobrable)).toBe(true);
  expect(MATRIZ.some((m) => !m.cobrable)).toBe(true);
  // El caso del bug: programado, sin cobrar, con la hora por venir.
  expect(sePuedeCobrar(turno({ fecha: FUTURO }), AHORA)).toBe(false);
});

describe("detalle del turno en Agenda", () => {
  async function montar(t: TurnoConPaciente) {
    api.get.mockImplementation(async (ruta: string) => (ruta.startsWith("/api/sms") ? [] : null));
    await act(async () => {
      render(<TurnoDetailSheet open turno={t} onClose={vi.fn()} onUpdated={vi.fn()} />);
    });
  }

  it.each(MATRIZ)("Cobrar como el servidor: $caso", async ({ t, cobrable }) => {
    await montar(t);
    expect(!!botonCobrar()).toBe(cobrable);
  });

  it("un turno de ayer sin grabar no ofrece Grabar (y sí Cobrar)", async () => {
    await montar(turno({ fecha: AYER }));
    expect(enlaceGrabar()).toBeNull();
    expect(botonCobrar()).not.toBeNull();
  });

  it("un turno de hoy sin grabar ofrece Grabar, antes y después de su hora", async () => {
    await montar(turno({ fecha: FUTURO }));
    expect(enlaceGrabar()?.getAttribute("href")).toBe("/grabar/t1");
    cleanup();
    await montar(turno({ fecha: PASADO }));
    expect(enlaceGrabar()).not.toBeNull();
  });
});

describe("fila de sesión (Hoy y Agenda)", () => {
  it.each(MATRIZ)("Cobrar como el servidor: $caso", ({ t, cobrable }) => {
    render(<SessionRow turno={t} ahora={AHORA} onCobrar={vi.fn()} onGrabar={vi.fn()} />);
    expect(!!botonCobrar()).toBe(cobrable);
  });

  it("Grabar solo el día del turno: ayer no, hoy sí", () => {
    render(<SessionRow turno={turno({ fecha: AYER })} ahora={AHORA} onGrabar={vi.fn()} />);
    expect(botonGrabar()).toBeNull();
    cleanup();
    render(<SessionRow turno={turno({ fecha: FUTURO })} ahora={AHORA} onGrabar={vi.fn()} />);
    expect(botonGrabar()).not.toBeNull();
  });

  it("sin `ahora` no ofrece Grabar: no puede saber si el turno es de hoy", () => {
    render(<SessionRow turno={turno({ fecha: AYER })} onGrabar={vi.fn()} />);
    expect(botonGrabar()).toBeNull();
  });
});

describe("tarjeta de ahora en Hoy", () => {
  function dia(t: TurnoConPaciente): DashboardData {
    return {
      inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: 1, deudaAcumulada: 0, ingresosMes: 0 },
      sesionesHoy: [t],
      deudores: [],
      proximaSesion: null,
      riesgoDelDia: [],
      pendientes: {
        notasParaRevisar: [],
        sinCobrar: [],
        totalSinCobrar: { pacientes: 0, sesiones: 0, monto: 0 },
        sinAutorizacion: [],
      },
    } as unknown as DashboardData;
  }

  it.each(MATRIZ_VIVOS)("Cobrar como el servidor: $caso", async ({ t, cobrable }) => {
    const d = repartirElDia(dia(t), AHORA);
    expect(d.ahoraTurno?.id).toBe("t1");
    expect(d.ahoraSinCobrar).toBe(cobrable);
    await act(async () => {
      render(
        <CardAhora
          turno={d.ahoraTurno!}
          ahora={AHORA}
          enCurso={d.enCurso}
          sinAutorizacion={false}
          sinCobrar={d.ahoraSinCobrar}
          onCobrar={vi.fn()}
        />,
      );
    });
    expect(!!botonCobrar()).toBe(cobrable);
  });
});

describe("ficha de la paciente: Turnos y pagos", () => {
  it.each(MATRIZ)("Cobrar como el servidor: $caso", ({ t, cobrable }) => {
    render(<TurnosPagosTab turnos={[t]} />);
    expect(!!botonCobrar()).toBe(cobrable);
  });
});

describe("ficha de la paciente: Sesiones, el turno de hoy con la nota aprobada", () => {
  function servir(docs: unknown[]) {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes("/documentacion")) {
        return { pacienteId: "p1", totalSesiones: docs.length, sesiones: docs, page: 1, totalPages: 1 };
      }
      throw new Error(`pedido inesperado: ${url}`);
    });
  }

  async function montar(t: TurnoConPaciente) {
    await act(async () => {
      render(
        <SesionesTab
          pacienteId="p1" pacienteNombre="Ana López" turnoHoy={t}
          sesionHoy={{ id: "s1", turnoId: t.id, estado: "aprobada" } as SesionClinicaEnsamblada}
          sesionHoyCargando={false} onTurnoActualizado={() => {}} onAviso={() => {}}
        />,
      );
    });
  }

  it.each(MATRIZ_VIVOS)("fila de hoy sin la nota en la lista — Cobrar como el servidor: $caso", async ({ t, cobrable }) => {
    servir([]);
    await montar(t);
    await screen.findByText(/min · /);
    expect(!!botonCobrar()).toBe(cobrable);
  });

  it.each(MATRIZ_VIVOS)("fila de hoy con la nota en la lista — Cobrar como el servidor: $caso", async ({ t, cobrable }) => {
    servir([{
      sesionClinicaId: "s1", turnoId: t.id, fecha: t.fecha.toISOString(), duracionMin: 50, duracionAudioSeg: 3000,
      modalidad: "presencial", estado: "aprobada", nota: null, datos: { resumenSesion: "Resumen de hoy" },
      feedback: null, aprobadaEn: t.fecha.toISOString(), procesadaEn: t.fecha.toISOString(),
    }]);
    await montar(t);
    await screen.findByText("Resumen de hoy");
    expect(!!botonCobrar()).toBe(cobrable);
  });
});

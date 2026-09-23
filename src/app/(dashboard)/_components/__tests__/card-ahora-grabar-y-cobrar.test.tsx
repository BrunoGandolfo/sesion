// @vitest-environment jsdom
//
// Grabar y Cobrar son independientes. Antes, pasada la hora del turno y con
// el pago pendiente, la tarjeta de ahora ofrecía sólo Cobrar: una sesión que
// empezaba cinco minutos tarde se quedaba sin botón para grabarla. Grabar se
// ofrece mientras el turno sea de hoy y no haya grabación; Cobrar, además.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData, TurnoConPaciente } from "@/types/domain";

import { CardAhora, accionDe } from "../card-ahora";
import { aplicarCobro, repartirElDia } from "../datos";

const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
}));

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(null);
});

// 15:00 en Montevideo; "ahora" son las 15:20.
const INICIO = new Date("2026-09-23T18:00:00.000Z");
const AHORA = new Date("2026-09-23T18:20:00.000Z");

function turno(cambios: Partial<TurnoConPaciente> = {}): TurnoConPaciente {
  return {
    id: "t1", serieId: null, pacienteId: "p1", organizationId: "org",
    fecha: INICIO, duracion: 50, modalidad: "presencial", estado: "programado",
    tarifaCobrada: 2200, pagoEstado: "pendiente", pagoFecha: null, pagoMetodo: null,
    notas: null, creadoEn: INICIO, actualizadoEn: INICIO, sesionClinica: null,
    paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099123456" },
    ...cambios,
  };
}

function dia(t: TurnoConPaciente, deudora = false): DashboardData {
  return {
    inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
    kpis: { sesionesHoy: 1, deudaAcumulada: 0, ingresosMes: 0 },
    sesionesHoy: [t],
    deudores: [],
    proximaSesion: null,
    riesgoDelDia: [],
    pendientes: {
      notasParaRevisar: [],
      sinCobrar: deudora
        ? [{ pacienteId: "p1", pacienteNombre: "Ana López", sesiones: 1, monto: 2200, masAntiguo: INICIO.toISOString() }]
        : [],
      totalSinCobrar: { pacientes: deudora ? 1 : 0, sesiones: deudora ? 1 : 0, monto: deudora ? 2200 : 0 },
      sinAutorizacion: [],
    },
  } as DashboardData;
}

/** Monta la tarjeta como la monta Hoy: con lo que reparte `repartirElDia`. */
async function montarComoHoy(data: DashboardData) {
  const d = repartirElDia(data, AHORA);
  expect(d.ahoraTurno).not.toBeNull();
  await act(async () => {
    render(
      <CardAhora
        turno={d.ahoraTurno!}
        ahora={AHORA}
        enCurso={d.enCurso}
        sinAutorizacion={d.sinAutorizacion.has(d.ahoraTurno!.id)}
        sinCobrar={d.ahoraSinCobrar}
        onCobrar={() => {}}
      />,
    );
  });
}

describe("la tarjeta de ahora con la hora ya pasada", () => {
  it("un turno de hace 20 minutos, sin grabar y agendado, ofrece Grabar y Cobrar a la vez", async () => {
    await montarComoHoy(dia(turno()));

    expect(screen.getByRole("link", { name: "Grabar sesión" }).getAttribute("href")).toBe("/grabar/t1");
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
  });

  it("también cuando el turno ya figura realizado y la paciente debe", async () => {
    await montarComoHoy(dia(turno({ estado: "realizado" }), true));

    expect(screen.getByRole("link", { name: "Grabar sesión" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
  });

  it("con la grabación empezada y sin terminar (\"grabando\") sigue ofreciendo Grabar", async () => {
    apiGet.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/api/sesion-clinica") ? { id: "s1", estado: "grabando" } : null),
    );
    await montarComoHoy(dia(turno()));

    expect(screen.getByRole("link", { name: "Grabar sesión" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
  });

  it("sin la firma, en lugar de Grabar va Firmar autorización, y Cobrar sigue al lado", () => {
    expect(accionDe(null, turno(), AHORA, true, true)).toEqual({
      tipo: "turno", grabar: "autorizar", cobrar: true, firma: null, hecho: false,
    });
  });

  it("un turno que no es de hoy no se graba", () => {
    const manana = new Date(AHORA.getTime() + 24 * 60 * 60 * 1000);
    const accion = accionDe(null, turno(), manana, false, true);
    expect(accion).toMatchObject({ tipo: "turno", grabar: null, cobrar: true });
  });
});

describe("con la sesión ya grabada no se ofrece Grabar", () => {
  for (const estado of ["procesando", "revision", "aprobada"] as const) {
    it(`sesión en "${estado}", según /api/sesion-clinica`, async () => {
      apiGet.mockImplementation((url: string) =>
        Promise.resolve(url.startsWith("/api/sesion-clinica") ? { id: "s1", estado } : null),
      );
      await montarComoHoy(dia(turno({ estado: "realizado", sesionClinica: { id: "s1", estado } }), true));

      expect(screen.queryByRole("link", { name: "Grabar sesión" })).toBeNull();
    });

    // Si /api/sesion-clinica falla o todavía no contestó, vale la sesión que
    // ya vino con el día: antes la tarjeta ofrecía Grabar sobre una sesión
    // aprobada o procesándose (con el turno ya cobrado, nada lo tapaba).
    it(`sesión en "${estado}", aunque /api/sesion-clinica no conteste`, async () => {
      apiGet.mockRejectedValue(new Error("sin red"));
      await montarComoHoy(dia(turno({ estado: "realizado", pagoEstado: "pagado", sesionClinica: { id: "s1", estado } })));

      expect(screen.queryByRole("link", { name: "Grabar sesión" })).toBeNull();
    });
  }
});

describe("cobrar un turno agendado cuya hora ya empezó", () => {
  it("lo deja realizado y pagado y suma al mes, sin tocar la deuda", () => {
    const data = dia(turno());
    const despues = aplicarCobro(data, "t1", "efectivo", AHORA);

    expect(despues.sesionesHoy[0]).toMatchObject({ estado: "realizado", pagoEstado: "pagado", pagoMetodo: "efectivo" });
    expect(despues.kpis.ingresosMes).toBe(2200);
    expect(despues.kpis.deudaAcumulada).toBe(0);
    expect(repartirElDia(despues, AHORA).ahoraSinCobrar).toBe(false);
  });
});

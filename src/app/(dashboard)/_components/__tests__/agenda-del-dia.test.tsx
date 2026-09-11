// @vitest-environment jsdom
//
// El estado vacío del día y la regla dura del personaje.
//
// docs/diseno/04-personaje.md: si alguna sesión del día tuvo señal de riesgo
// —lo que decide `clavesDeRiesgo`—, Lupita no aparece en esa pantalla ese
// día. No alcanza con que no esté en la pantalla del riesgo: tiene que no
// estar en el camino de esa sesión. Lo que sí queda, siempre, es el texto:
// el dibujo acompaña palabras que ya dicen todo.

import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  COBRAR,
  HOY_SIN_TURNOS_DETALLE,
  HOY_SIN_TURNOS_TITULO,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { AgendaDelDia } from "../agenda-del-dia";
import { hayRiesgoEnElDia } from "../datos";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const AHORA = new Date("2026-09-07T15:00:00.000Z");

const TURNO: TurnoConPaciente = {
  sesionClinica: null,
  id: "t1",
  organizationId: "org",
  pacienteId: "p1",
  fecha: new Date("2026-09-07T13:00:00.000Z"),
  duracion: 50,
  modalidad: "presencial",
  estado: "realizado",
  pagoEstado: "pendiente",
  pagoMetodo: null,
  pagoFecha: null,
  tarifaCobrada: 2200,
  notas: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"),
  actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  paciente: {
    id: "p1",
    nombre: "Ana",
    apellido: "López",
    telefono: "099111222",
  },
};

function conUnTurno(turnoCobrado: string | null) {
  return render(
    <AgendaDelDia
      turnos={[TURNO]}
      ahora={AHORA}
      notaPorTurno={new Map()}
      sinAutorizacion={new Set()}
      onCobrar={() => {}}
      onAgendar={() => {}}
      turnoCobrado={turnoCobrado}
    />,
  );
}

function diaVacio(riesgoEnElDia: boolean) {
  return render(
    <AgendaDelDia
      turnos={[]}
      ahora={AHORA}
      notaPorTurno={new Map()}
      sinAutorizacion={new Set()}
      onCobrar={() => {}}
      onAgendar={() => {}}
      riesgoEnElDia={riesgoEnElDia}
    />,
  );
}

describe("Hoy sin turnos", () => {
  it("mantiene el texto y reduce a 72 px el dibujo del estado vacío", () => {
    const { container } = diaVacio(false);

    expect(screen.getByText(HOY_SIN_TURNOS_TITULO)).toBeTruthy();
    expect(screen.getByText(HOY_SIN_TURNOS_DETALLE)).toBeTruthy();

    const lupita = container.querySelector("svg[data-pose]");
    expect(lupita).not.toBeNull();
    expect(lupita?.getAttribute("width")).toBe("72");
    // Decoración de un texto que ya dice todo.
    expect(lupita?.getAttribute("aria-hidden")).toBe("true");
  });

  it("no dibuja a Lupita si alguna sesión del día tuvo señal de riesgo", () => {
    const { container } = diaVacio(true);

    expect(container.querySelector("svg[data-pose]")).toBeNull();
    // El texto no cambia: el que habla es el texto, no el dibujo.
    expect(screen.getByText(HOY_SIN_TURNOS_TITULO)).toBeTruthy();
    expect(screen.getByText(HOY_SIN_TURNOS_DETALLE)).toBeTruthy();
  });
});

describe("el cobro se confirma en la fila que lo originó (D9)", () => {
  /** Cuántos dibujos hay en el bloque. La fila marcada tiene uno más: el
   *  trazo del check, que se dibuja donde estaba el botón. */
  function dibujos(vista: ReturnType<typeof conUnTurno>): number {
    return vista.container.querySelectorAll("svg").length;
  }

  it("sin cobro en curso, la fila ofrece Cobrar", () => {
    conUnTurno(null);
    expect(screen.getByText(COBRAR)).toBeTruthy();
  });

  it("con el cobro recién entrado, la marca ocupa el lugar del botón", () => {
    // El check se dibuja donde estaba "Cobrar", que es donde ella tocó.
    const sinMarca = dibujos(conUnTurno(null));
    cleanup();
    const conMarca = dibujos(conUnTurno("t1"));

    expect(screen.queryByText(COBRAR)).toBeNull();
    expect(conMarca).toBe(sinMarca + 1);
  });

  it("la marca es sólo de la fila que se cobró", () => {
    conUnTurno("otro-turno");

    expect(screen.getByText(COBRAR)).toBeTruthy();
  });
});

describe("hayRiesgoEnElDia", () => {
  /** La señal graduada tal como la manda /api/dashboard: la forma completa
   *  del contrato, vacía de contenido. Sin las tres claves de más, el guard
   *  de `normalizarRiesgo` la lee como "ninguno". */
  const senal = (nivel: string) => ({
    nivel,
    indicadores: [] as string[],
    evidencia: [] as never[],
    notaParaTerapeuta: null,
  });

  const SIN_FLAGS = {
    ideacionSuicida: false,
    autolesion: false,
    violenciaTerceros: false,
    sintomasPsicoticos: false,
    crisisPanico: false,
    detalle: "",
  };

  it("es false sin sesiones y con sesiones sin señal", () => {
    expect(hayRiesgoEnElDia(undefined)).toBe(false);
    expect(hayRiesgoEnElDia([])).toBe(false);
    expect(
      hayRiesgoEnElDia([
        { riesgoDetectado: senal("ninguno"), flagsRiesgo: SIN_FLAGS },
        { riesgoDetectado: null, flagsRiesgo: null },
      ]),
    ).toBe(false);
  });

  it("es true con el nivel graduado, con un flag activo, y basta una sesión", () => {
    expect(
      hayRiesgoEnElDia([
        { riesgoDetectado: senal("bajo"), flagsRiesgo: null },
      ]),
    ).toBe(true);
    expect(
      hayRiesgoEnElDia([
        {
          riesgoDetectado: null,
          flagsRiesgo: { ...SIN_FLAGS, ideacionSuicida: true },
        },
      ]),
    ).toBe(true);
    expect(
      hayRiesgoEnElDia([
        { riesgoDetectado: senal("ninguno"), flagsRiesgo: SIN_FLAGS },
        { riesgoDetectado: senal("alto"), flagsRiesgo: SIN_FLAGS },
      ]),
    ).toBe(true);
  });
});

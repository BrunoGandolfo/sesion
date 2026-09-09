// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// D9: cuando el sheet del turno se va, la fila que originó el cobro queda
// con su marca. Lo que se protege acá es que la marca caiga en ESA fila y en
// ninguna otra: es la diferencia entre "lo que tocaste se hizo" y un chip
// que cambió solo.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DayView } from "../day-view";
import { AGENDA_DIA_VACIO_TITULO } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

const DIA = new Date("2026-09-07T12:00:00.000Z");

function turno(
  id: string,
  nombre: string,
  hora: number,
): TurnoConPaciente {
  return {
    id,
    pacienteId: `p-${id}`,
    fecha: new Date(`2026-09-07T${String(hora).padStart(2, "0")}:00:00.000Z`),
    duracion: 50,
    modalidad: "presencial",
    estado: "realizado",
    tarifaCobrada: 2200,
    pagoEstado: "pagado",
    pagoFecha: new Date("2026-09-07T13:00:00.000Z"),
    pagoMetodo: "efectivo",
    notas: null,
    creadoEn: DIA,
    actualizadoEn: DIA,
    organizationId: "org",
    paciente: {
      id: `p-${id}`,
      nombre,
      apellido: "Fernández",
      telefono: "099 123 456",
    },
  } as TurnoConPaciente;
}

const TURNOS = [turno("t1", "Lucía", 13), turno("t2", "Mercedes", 15)];

/** El trazo del check, que no tiene rótulo porque es decoración de un
 *  cambio de estado que la fila ya dice con su chip. */
function checksDe(container: HTMLElement) {
  return container.querySelectorAll('path[d="M20 6 9 17l-5-5"]');
}

function montar(turnoCobradoId?: string) {
  return render(
    <DayView
      date={DIA}
      turnos={TURNOS}
      turnoCobradoId={turnoCobradoId}
      onOpenTurno={() => {}}
      onNuevoTurno={() => {}}
    />,
  );
}

describe("DayView", () => {
  it("sin cobro reciente no hay ninguna marca", () => {
    const { container } = montar();

    expect(screen.getByText(/Lucía/)).toBeDefined();
    expect(checksDe(container)).toHaveLength(0);
  });

  it("marca sólo la fila del turno que se acaba de cobrar", () => {
    const { container } = montar("t2");

    const checks = checksDe(container);
    expect(checks).toHaveLength(1);

    // Y está dentro de la fila de Mercedes, no de la de Lucía: se sube desde
    // el trazo hasta el primer ancestro que nombra a alguien.
    let fila: HTMLElement | null = checks[0].parentElement;
    while (fila && !fila.textContent?.includes("Mercedes")) {
      fila = fila.parentElement;
    }
    expect(fila).not.toBeNull();
    expect(fila?.textContent).not.toContain("Lucía");
  });

  it("sin turnos muestra el estado vacío, que no lleva marcas", () => {
    const { container } = render(
      <DayView
        date={DIA}
        turnos={[]}
        onOpenTurno={() => {}}
        onNuevoTurno={() => {}}
      />,
    );

    expect(screen.getByText(AGENDA_DIA_VACIO_TITULO)).toBeDefined();
    expect(checksDe(container)).toHaveLength(0);
  });
});

// @vitest-environment jsdom
//
// Cada día del mes dice sus turnos con puntos, uno por turno, y nada más: el
// número al lado se fue. Con más de cuatro, tres puntos y un "+". La
// cantidad exacta la sigue diciendo el nombre accesible de la celda.
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MonthView } from "../month-view";
import type { TurnoConPaciente } from "@/types/domain";

const fecha = new Date("2026-09-15T15:00:00Z");
const turnos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), fecha, pagoEstado: i === 0 ? "pagado" : "pendiente" }) as TurnoConPaciente);

function puntosDe(dia: HTMLElement) {
  return dia.querySelectorAll("[data-punto]");
}

it("un día con seis turnos muestra tres puntos y un +, sin número", () => {
  const onDayClick = vi.fn();
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos(6)} onDayClick={onDayClick} />);
  const dia = screen.getByRole("button", { name: /martes 15 de septiembre: 6 turnos/ });
  expect(puntosDe(dia)).toHaveLength(3);
  const puntos = dia.querySelector("[data-puntos]")!;
  expect(puntos.textContent).toBe("+");
  // En la celda angosta del teléfono el "+" no salta a otro renglón.
  expect(puntos.className).toContain("flex-nowrap");
  // Lo único numérico de la celda es el número del día.
  expect(dia.textContent).toBe("15+");
  fireEvent.click(dia);
  expect(onDayClick.mock.calls[0][0].getDate()).toBe(15);
});

it.each([1, 2, 4])("con %i turnos dibuja un punto por turno y ningún número al lado", (n) => {
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos(n)} onDayClick={vi.fn()} />);
  const dia = screen.getByRole("button", { name: new RegExp(`15 de septiembre: ${n} turnos?$`) });
  expect(puntosDe(dia)).toHaveLength(n);
  expect(dia.textContent).toBe("15");
});

it("en ningún día del mes hay un número junto a los puntos", () => {
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos(5)} onDayClick={vi.fn()} />);
  for (const grupo of document.querySelectorAll("[data-puntos]")) {
    expect(grupo.textContent).not.toMatch(/\d/);
  }
});

it("anuncia cero y singular sin confundir el número del día con la cantidad", () => {
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos(1)} onDayClick={vi.fn()} />);
  expect(screen.getByRole("button", { name: /15 de septiembre: 1 turno$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /16 de septiembre: 0 turnos$/ })).toBeTruthy();
});

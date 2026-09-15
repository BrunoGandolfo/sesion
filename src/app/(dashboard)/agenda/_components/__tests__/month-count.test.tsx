// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MonthView } from "../month-view";
import type { TurnoConPaciente } from "@/types/domain";
const fecha = new Date("2026-09-15T15:00:00Z");
const turnos = Array.from({length:5}, (_,i) => ({id:String(i),fecha,pagoEstado:i===0?"pagado":"pendiente"}) as TurnoConPaciente);
it("muestra la cantidad completa, también cuando antes sólo decía +2", () => {
  const onDayClick = vi.fn();
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos} onDayClick={onDayClick} />);
  const dia = screen.getByRole("button", {name:/martes 15 de septiembre: 5 turnos/});
  expect(within(dia).getByText("5")).toBeTruthy();
  expect(within(dia).queryByText("+2")).toBeNull();
  fireEvent.click(dia);
  expect(onDayClick.mock.calls[0][0].getDate()).toBe(15);
});
it("anuncia cero y singular sin confundir el número del día con la cantidad", () => {
  render(<MonthView anchor={fecha} today={fecha} turnos={turnos.slice(0,1)} onDayClick={vi.fn()} />);
  expect(screen.getByRole("button",{name:/15 de septiembre: 1 turno$/})).toBeTruthy();
  expect(screen.getByRole("button",{name:/16 de septiembre: 0 turnos$/})).toBeTruthy();
});

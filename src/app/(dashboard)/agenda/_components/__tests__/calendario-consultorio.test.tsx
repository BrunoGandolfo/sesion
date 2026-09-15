// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MonthView } from "../month-view";
import { WeekView } from "../week-view";
import { DayView } from "../day-view";
import { AgendaHeader } from "../agenda-header";
import type { TurnoConPaciente } from "@/types/domain";

vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
const zonaOriginal = process.env.TZ;
afterEach(() => {
  cleanup();
  if (zonaOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = zonaOriginal;
});
function turno(nombre: string, iso: string): TurnoConPaciente {
  const fecha = new Date(iso);
  return {
    id: nombre, pacienteId: nombre, organizationId: "prueba", fecha, duracion: 90,
    modalidad: "presencial", estado: "programado", tarifaCobrada: 2200,
    pagoEstado: "pendiente", pagoFecha: null, pagoMetodo: null, notas: null, serieId: null,
    creadoEn: fecha, actualizadoEn: fecha, sesionClinica: null,
    paciente: { id: nombre, nombre, apellido: "Prueba", telefono: "099123456" },
  };
}

describe.each(["UTC", "Europe/Madrid", "America/Montevideo", "America/Los_Angeles"])("agenda en %s", zona => {
  it("tocar el 15 devuelve el 15 del consultorio y el día muestra su turno nocturno", () => {
    process.env.TZ = zona;
    const anchor = new Date("2026-09-15T15:00:00Z");
    const abrirDia = vi.fn();
    const noche = turno("Noche", "2026-09-16T01:30:00Z"); // 15, 22:30 Mvd.
    const manana = turno("Mañana", "2026-09-16T12:00:00Z");
    const mes = render(<MonthView anchor={anchor} today={anchor} turnos={[noche, manana]} onDayClick={abrirDia} />);
    fireEvent.click(screen.getByText("15", { selector: "span" }).closest("button")!);
    const fecha = abrirDia.mock.calls[0][0] as Date;
    expect(fecha.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    mes.unmount();
    const abrir = vi.fn();
    render(<DayView date={fecha} turnos={[noche, manana]} onOpenTurno={abrir} onNuevoTurno={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Noche Prueba/ }));
    expect(abrir).toHaveBeenCalledWith(noche);
    expect(screen.queryByText("Mañana Prueba")).toBeNull();
  });

  it("mantiene el domingo nocturno en su semana, con la escala completa aprobada", () => {
    process.env.TZ = zona;
    const noche = turno("Noche", "2026-09-21T02:30:00Z"); // Domingo 20, 23:30.
    render(<WeekView anchor={noche.fecha} today={noche.fecha} turnos={[noche]} onEventClick={vi.fn()} />);
    const boton = screen.getByRole("button", { name: "Noche Prueba 23:30" });
    expect(parseFloat(boton.style.top)).toBe(15.5 * 64);
    expect(parseFloat(boton.style.height)).toBe(94);
    expect(screen.getByText("00:00 (+1 día)")).toBeTruthy();
    expect(screen.queryByText("24:00")).toBeNull();
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
  });

  it("el título semanal y el mensual nombran el mismo calendario que la grilla", () => {
    process.env.TZ = zona;
    const props = { anchor: new Date("2027-01-01T02:30:00Z"), onViewChange: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onToday: vi.fn(), onNewTurno: vi.fn(), mesAbierto: false, onToggleMes: vi.fn() };
    const vista = render(<AgendaHeader {...props} view="semana" />);
    expect(screen.getByText("28 dic — 3 ene")).toBeTruthy();
    vista.rerender(<AgendaHeader {...props} view="mes" />);
    expect(screen.getByText("diciembre 2026")).toBeTruthy();
    expect(screen.getByText("jueves 31 de diciembre")).toBeTruthy();
  });
});

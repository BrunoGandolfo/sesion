// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TurnoConPaciente } from "@/types/domain";
import { WeekView } from "../week-view";
import { distribuirTurnos } from "../week-layout";

const dia = new Date("2026-09-07T12:00:00-03:00");
function turno(id: string, hora: number, minuto = 0, duracion: TurnoConPaciente["duracion"] = 50): TurnoConPaciente {
  return {
    id, pacienteId: id, organizationId: "org", fecha: new Date(`2026-09-07T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00-03:00`),
    duracion, modalidad: "presencial", estado: "programado", tarifaCobrada: 2200,
    pagoEstado: "pendiente", pagoFecha: null, pagoMetodo: null, notas: null,
    creadoEn: dia, actualizadoEn: dia, sesionClinica: null,
    paciente: { id, nombre: id, apellido: "Prueba", telefono: "099123456" },
  };
}

describe("agenda semanal sin tarjetas tapadas", () => {
  it("renderiza tres turnos simultáneos en columnas distintas y conserva la acción", () => {
    const turnos = [turno("Ana", 10), turno("Bea", 10), turno("Cata", 10)];
    const abrir = vi.fn();
    render(<WeekView anchor={dia} today={dia} turnos={turnos} onEventClick={abrir} />);
    const botones = screen.getAllByRole("button");
    expect(new Set(botones.map((b) => b.style.left)).size).toBe(3);
    for (const boton of botones) {
      expect(boton.style.width).toBe("calc(33.3333% - 4px)");
      expect(boton.title).toContain("10:00");
      expect(boton.textContent).toContain("Prueba");
    }
    fireEvent.click(botones[1]);
    expect(abrir).toHaveBeenCalledWith(turnos[1]);
  });

  it("deja completos los turnos consecutivos de media hora y espacio para ambas líneas", () => {
    render(<WeekView anchor={dia} today={dia} turnos={[turno("Ana", 10, 0, 30), turno("Bea", 10, 30, 30)]} onEventClick={() => {}} />);
    const [a, b] = screen.getAllByRole("button");
    expect(a.style.width).toBe("calc(100% - 4px)");
    expect(b.style.width).toBe(a.style.width);
    expect(parseFloat(a.style.height)).toBeGreaterThanOrEqual(30);
    expect(parseFloat(a.style.top) + parseFloat(a.style.height)).toBeLessThan(parseFloat(b.style.top));
  });

  it("reserva columnas para todo el grupo transitivo y las libera después", () => {
    const originales = [turno("C", 11), turno("A", 10), turno("B", 10, 40), turno("D", 12)];
    const posiciones = distribuirTurnos(originales, 8);
    expect(posiciones.map((p) => [p.turno.id, p.columna, p.columnas])).toEqual([
      ["A", 0, 2], ["B", 1, 2], ["C", 0, 2], ["D", 0, 1],
    ]);
    expect(originales.map((t) => t.id)).toEqual(["C", "A", "B", "D"]);
    for (const a of posiciones) for (const b of posiciones) {
      if (a === b || a.top + a.height <= b.top || b.top + b.height <= a.top) continue;
      expect(a.columna).not.toBe(b.columna);
    }
  });

  it("no muestra turnos de otra semana ni agrega acciones a un calendario vacío", () => {
    const otro = turno("Otro", 10);
    otro.fecha = new Date(2026, 8, 20, 10);
    render(<WeekView anchor={dia} today={dia} turnos={[otro]} onEventClick={() => {}} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

it('extiende la escala para mostrar enteros los turnos antes de las 8 y después de las 21', () => {
 const temprano={...turno('Temprano',7),fecha:new Date(2026,8,7,7)};
 const tarde={...turno('Tarde',22,30,90),fecha:new Date(2026,8,7,22,30)};
 const abrir=vi.fn();
 const {container}=render(<WeekView anchor={dia} today={dia} turnos={[temprano,tarde]} onEventClick={abrir} />);
 const [a,b]=screen.getAllByRole('button');
 expect(screen.getAllByText('07:00').length).toBeGreaterThanOrEqual(1);
 expect(screen.getByText('23:00')).toBeTruthy();
 expect(parseFloat(a.style.top)).toBe(0);
 const alturaGrilla=17*64;
 expect(parseFloat(b.style.top)+parseFloat(b.style.height)).toBeLessThanOrEqual(alturaGrilla);
 expect(container.textContent).toContain('Tarde Prueba');
 fireEvent.click(b);
 expect(abrir).toHaveBeenCalledWith(tarde);
 expect(tarde.fecha.getHours()).toBe(22);
});

it('identifica la continuación después de medianoche sin inventar una hora 24', () => {
 render(<WeekView anchor={dia} today={dia} turnos={[{...turno('Noche',23,30,90),fecha:new Date(2026,8,7,23,30)}]} onEventClick={() => {}} />);
 expect(screen.getByText('00:00 (+1 día)')).toBeTruthy();
 expect(screen.queryByText('24:00')).toBeNull();
});

// @vitest-environment jsdom
//
// "Paciente estático no sirve para nada: intuitivamente lo tocás y te debe
// llevar a paciente." El cuerpo de la fila lleva a la ficha, en Hoy y en
// Agenda; el detalle del turno queda en un control aparte. Y Grabar no se
// va cuando pasó la hora: grabar y cobrar son dos cosas independientes.
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SessionRow } from "../session-row";
import type { TurnoConPaciente } from "@/types/domain";

// 2026-09-07 10:00 de Montevideo.
const TURNO: TurnoConPaciente = {
  sesionClinica: null, id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
  fecha: new Date("2026-09-07T13:00:00.000Z"), duracion: 50, modalidad: "presencial",
  estado: "programado", pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null,
  tarifaCobrada: 2200, notas: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"), actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222" },
};

const VEINTE_MINUTOS_DESPUES = new Date("2026-09-07T13:20:00.000Z");

it("en Agenda el cuerpo lleva a la ficha y el detalle se abre desde 'Ver turno'", () => {
  const abrirTurno = vi.fn();
  render(<SessionRow turno={TURNO} onClick={abrirTurno} />);

  const cuerpo = screen.getByRole("link", { name: /Ana López/ });
  expect(cuerpo.getAttribute("href")).toBe("/pacientes/p1");
  // La hora también es parte del cuerpo tocable.
  expect(cuerpo.textContent).toContain("10:00");
  expect(cuerpo.closest("button")).toBeNull();

  const verTurno = screen.getByRole("button", { name: "Ver turno de Ana López" });
  expect(verTurno.className).toContain("min-h-[44px]");
  expect(verTurno.className).toContain("min-w-[44px]");
  expect(cuerpo.contains(verTurno)).toBe(false);
  fireEvent.click(verTurno);
  expect(abrirTurno).toHaveBeenCalledOnce();
});

it("en Hoy, sin onClick, el cuerpo también lleva a la ficha y no hay 'Ver turno'", () => {
  render(<SessionRow turno={TURNO} ahora={VEINTE_MINUTOS_DESPUES} onCobrar={vi.fn()} onGrabar={vi.fn()} />);

  expect(screen.getByRole("link", { name: /Ana López/ }).getAttribute("href")).toBe("/pacientes/p1");
  expect(screen.queryByRole("button", { name: /Ver turno/ })).toBeNull();
});

it("veinte minutos después de la hora, sin grabación y sin cobrar, ofrece Grabar y Cobrar a la vez", () => {
  const grabar = vi.fn();
  const cobrar = vi.fn();
  render(<SessionRow turno={TURNO} ahora={VEINTE_MINUTOS_DESPUES} onCobrar={cobrar} onGrabar={grabar} />);

  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
  expect(grabar).toHaveBeenCalledOnce();
  expect(cobrar).toHaveBeenCalledOnce();
});

it("con la grabación empezada y sin terminar, pasada la hora, sigue ofreciendo las dos", () => {
  render(
    <SessionRow
      turno={{ ...TURNO, sesionClinica: { id: "s1", estado: "grabando" } }}
      ahora={VEINTE_MINUTOS_DESPUES}
      onCobrar={vi.fn()}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Grabar sesión" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it("con la grabación ya enviada, pasada la hora, queda sólo Cobrar", () => {
  render(
    <SessionRow
      turno={{ ...TURNO, estado: "realizado", sesionClinica: { id: "s1", estado: "procesando" } }}
      ahora={VEINTE_MINUTOS_DESPUES}
      onCobrar={vi.fn()}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it("un turno de ayer sin cobrar se cobra, pero ya no se graba", () => {
  render(
    <SessionRow
      turno={TURNO}
      ahora={new Date("2026-09-08T13:20:00.000Z")}
      onCobrar={vi.fn()}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it("sin la firma, el aviso ocupa el lugar de Grabar y Cobrar sigue al lado", () => {
  render(
    <SessionRow
      turno={TURNO}
      ahora={VEINTE_MINUTOS_DESPUES}
      sinAutorizacion
      onAutorizar={vi.fn()}
      onCobrar={vi.fn()}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  expect(screen.getByRole("button", { name: /Falta la autorización/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it("antes de la hora se graba y todavía no se cobra", () => {
  render(
    <SessionRow
      turno={TURNO}
      ahora={new Date("2026-09-07T12:40:00.000Z")}
      onCobrar={vi.fn()}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Grabar sesión" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
});

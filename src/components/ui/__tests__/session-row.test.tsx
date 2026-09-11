// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TurnosPagosTab } from "@/app/(dashboard)/pacientes/[id]/_components/turnos-pagos-tab";
import { SessionRow } from "../session-row";
import type { TurnoConPaciente } from "@/types/domain";

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

it.each([["revision", "Revisar nota"], ["aprobado", "Ver nota"]])("enlaza la nota %s aunque haya un cobro pendiente", (estado, label) => {
  const abrirTurno = vi.fn();
  const cobrar = vi.fn();
  render(<SessionRow turno={{ ...TURNO, sesionClinica: { id: "nota-1", estado } }} onClick={abrirTurno} onCobrar={cobrar} />);
  const enlace = screen.getByRole("link", { name: label });
  expect(enlace.getAttribute("href")).toBe("/sesiones/nota-1");
  expect(enlace.closest("button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
  expect(cobrar).toHaveBeenCalledOnce();
  expect(abrirTurno).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Ana López/ }));
  expect(abrirTurno).toHaveBeenCalledOnce();
});

it.each(["procesando", "transcribiendo"])("muestra %s sin enlace ni opción de grabar de nuevo", (estado) => {
  render(<SessionRow turno={{ ...TURNO, estado: "programado", sesionClinica: { id: "nota-1", estado } }} onGrabar={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("Procesando");
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
});

it("sin sesión clínica no muestra estado ni acceso a una nota", () => {
  render(<SessionRow turno={TURNO} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});

it.each(["grabando", "subiendo"])("con la grabación cortada en %s sigue ofreciendo grabar", (estado) => {
  const grabar = vi.fn();
  render(
    <SessionRow
      turno={{ ...TURNO, estado: "programado", sesionClinica: { id: "s1", estado } }}
      ahora={new Date("2026-09-07T12:00:00.000Z")}
      onGrabar={grabar}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  expect(grabar).toHaveBeenCalledOnce();
});

it("con la nota en revisión ya no ofrece grabar", () => {
  render(
    <SessionRow
      turno={{ ...TURNO, estado: "programado", sesionClinica: { id: "s1", estado: "revision" } }}
      ahora={new Date("2026-09-07T12:00:00.000Z")}
      onGrabar={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  expect(screen.getByRole("link", { name: "Revisar nota" })).toBeTruthy();
});

it("llama Sin cobrar al pago pendiente sin cambiar el estado del turno", () => {
  render(<SessionRow turno={TURNO} />);
  expect(screen.getByText("Sin cobrar")).toBeTruthy();
  expect(screen.queryByText("Pendiente")).toBeNull();
  expect(TURNO.pagoEstado).toBe("pendiente");
});

it("usa Sin cobrar también en los turnos de la ficha", () => {
  render(<TurnosPagosTab turnos={[TURNO]} />);
  expect(screen.getByText("Sin cobrar")).toBeTruthy();
  expect(screen.queryByText("Pendiente")).toBeNull();
});

it('permite leer la duración de la sesión como texto secundario',()=>{
 render(<SessionRow turno={TURNO}/>);
 const duracion=screen.getByText('50 min');
 expect(duracion.classList.contains('text-ink-500')).toBe(true);
 expect(duracion.classList.contains('text-[12px]')).toBe(true);
});

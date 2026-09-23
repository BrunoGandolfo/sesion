// @vitest-environment jsdom
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pendientes } from "./pendientes";
import type { PendientesTerapeuta } from "@/types/domain";

const vacios: PendientesTerapeuta = {
  notasParaRevisar: [],
  sinCobrar: [],
  sinAutorizacion: [],
  totalSinCobrar: { pacientes: 0, sesiones: 0, monto: 0 },
};

it("ordena los pasos de una cuenta vacía y retira los cumplidos", () => {
  const { rerender } = render(<Pendientes pendientes={vacios} inicio={{ tarifaCargada: false, tienePacientes: false, tieneTurnos: false }} />);
  expect(screen.getAllByRole("link").map((enlace) => [enlace.textContent, enlace.getAttribute("href")])).toEqual([
    ["Cargá tu tarifa", "/config"],
    ["Cargá tu primera paciente", "/pacientes"],
    ["Agendá la primera sesión", "/agenda"],
  ]);
  rerender(<Pendientes pendientes={vacios} inicio={{ tarifaCargada: true, tienePacientes: false, tieneTurnos: false }} />);
  expect(screen.queryByText("Cargá tu tarifa")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(2);
  rerender(<Pendientes pendientes={vacios} inicio={{ tarifaCargada: true, tienePacientes: true, tieneTurnos: false }} />);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Agendá la primera sesión" })).toBeTruthy();
  rerender(<Pendientes pendientes={vacios} inicio={{ tarifaCargada: true, tienePacientes: true, tieneTurnos: true }} />);
  expect(screen.queryByRole("link")).toBeNull();
});

it("no confunde pendientes vacíos con una cuenta nueva cuando faltan los datos", () => {
  render(<Pendientes pendientes={vacios} />);
  expect(screen.queryByRole("link")).toBeNull();
});

// Las notas que fallaron, de cualquier día: antes sólo aparecían en la
// tarjeta o la fila del turno de HOY, y una de la semana pasada no se
// encontraba sin entrar a la ficha de la paciente.
it("muestra una nota fallida de hace una semana con nombre, fecha y el acceso a su nota", () => {
  const fallida = {
    sesionId: "s-vieja",
    turnoId: "t-vieja",
    pacienteId: "p1",
    pacienteNombre: "Ana López",
    fecha: "2026-09-16T15:00:00.000Z",
    codigo: "intentos_agotados",
    puedeReintentarse: true,
    // No viaja, pero si viajara tampoco se muestra.
    falloDetalle: "AssemblyAI 500: upstream timeout",
  };
  render(<Pendientes pendientes={{ ...vacios, notasFallidas: [fallida] }} />);

  expect(screen.getByText("1 nota que no se pudo escribir")).toBeTruthy();
  const enlace = screen.getByRole("link", { name: /Ana López/ });
  expect(enlace.getAttribute("href")).toBe("/sesiones/s-vieja");
  expect(enlace.textContent).toContain("16 sep");
  expect(enlace.textContent).toContain("Ver qué pasó");
  expect(enlace.textContent).not.toContain("No se puede reintentar");
  expect(document.body.textContent).not.toContain("AssemblyAI");
  expect(document.body.textContent).not.toContain("intentos_agotados");
});

it("una nota fallida que no puede reintentarse lo dice", () => {
  render(
    <Pendientes
      pendientes={{
        ...vacios,
        notasFallidas: [
          { sesionId: "s1", turnoId: "t1", pacienteId: "p1", pacienteNombre: "Ana López", fecha: "2026-09-16T15:00:00.000Z", codigo: null, puedeReintentarse: false },
          { sesionId: "s2", turnoId: "t2", pacienteId: "p2", pacienteNombre: "Beatriz Díaz", fecha: "2026-09-18T15:00:00.000Z", codigo: null, puedeReintentarse: true },
        ],
      }}
    />,
  );

  expect(screen.getByText("2 notas que no se pudieron escribir")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Ana López/ }).textContent).toContain("No se puede reintentar; se puede eliminar");
  expect(screen.getByRole("link", { name: /Beatriz Díaz/ }).textContent).not.toContain("No se puede reintentar");
});

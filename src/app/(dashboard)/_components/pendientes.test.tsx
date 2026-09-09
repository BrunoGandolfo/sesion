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

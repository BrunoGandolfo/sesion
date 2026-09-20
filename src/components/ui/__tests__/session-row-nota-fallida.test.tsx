// @vitest-environment jsdom
//
// El estado clínico del turno va separado del pago. Una sesión cuya nota
// FALLÓ se veía sólo como "Cobrar": la deuda tapaba el problema clínico y se
// podía cerrar el día sin enterarse.
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { SessionRow } from "../session-row";
import type { TurnoConPaciente } from "@/types/domain";

const TURNO: TurnoConPaciente = {
  sesionClinica: null, id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
  fecha: new Date("2026-09-07T13:00:00.000Z"), duracion: 50, modalidad: "presencial",
  estado: "realizado", pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null,
  tarifaCobrada: 2200, notas: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"), actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222" },
};

it("una nota fallida se ve como tal, lleva a la sesión y no se confunde con el cobro", () => {
  render(
    <SessionRow
      turno={{ ...TURNO, sesionClinica: { id: "nota-1", estado: "fallida" } }}
      onCobrar={() => {}}
    />,
  );

  const fallida = screen.getByRole("link", { name: /Nota fallida.*Ver qué pasó/ });
  expect(fallida.getAttribute("href")).toBe("/sesiones/nota-1");
  expect(screen.queryByText("Revisar nota")).toBeNull();
  // El cobro sigue ahí, aparte: son dos cosas distintas.
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it.each([
  ["revision", "Para revisar"],
  ["aprobada", "Nota lista"],
])("la nota %s se rotula '%s' y el pago va aparte", (estado, rotulo) => {
  render(<SessionRow turno={{ ...TURNO, pagoEstado: "pagado", sesionClinica: { id: "nota-1", estado } }} />);

  expect(screen.getByRole("link", { name: rotulo }).getAttribute("href")).toBe("/sesiones/nota-1");
  expect(screen.getByText("Pagado")).toBeTruthy();
});

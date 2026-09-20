// @vitest-environment jsdom
//
// La tarjeta de ahora cortaba en "Firmar autorización" y nunca llegaba a
// ofrecer Cobrar. Cobrar no depende de la firma: una sesión que no se grabó
// se cobra igual, y el aviso de la firma va al lado (la fila ya lo hacía así).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { CardAhora } from "../card-ahora";
import type { TurnoConPaciente } from "@/types/domain";

vi.mock("@/lib/api-client", () => ({ apiGet: vi.fn().mockResolvedValue(null) }));

const fecha = new Date(2026, 8, 11, 19);
const TURNO: TurnoConPaciente = {
  id: "t1", serieId: null, pacienteId: "p1", organizationId: "org",
  fecha, duracion: 50, modalidad: "presencial", estado: "programado",
  tarifaCobrada: 2200, pagoEstado: "pendiente", pagoFecha: null, pagoMetodo: null,
  notas: null, creadoEn: fecha, actualizadoEn: fecha, sesionClinica: null,
  paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099123456" },
};

it("ofrece Cobrar aunque falte la autorización, y avisa de la firma al lado", async () => {
  const onCobrar = vi.fn();
  await act(async () => {
    render(<CardAhora turno={TURNO} enCurso={false} sinAutorizacion sinCobrar onCobrar={onCobrar} />);
  });

  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
  expect(onCobrar).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: /Falta la autorización/ }).getAttribute("href")).toBe("/pacientes/p1");
});

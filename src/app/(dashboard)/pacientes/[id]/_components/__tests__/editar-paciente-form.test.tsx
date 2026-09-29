// @vitest-environment jsdom
// La edición usa los mismos campos que el alta: el teléfono abre el teclado
// de teléfono y el error de la tarifa se anuncia, atado a su campo.
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { EditarPacienteForm } from "../editar-paciente-form";

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPatch: vi.fn(),
}));

const PACIENTE = { id: "p1", nombre: "Ana", apellido: "López", telefono: "+59899111222", tarifa: 2000 };

it("el teléfono es un campo de teléfono", () => {
  render(<EditarPacienteForm paciente={PACIENTE} onSuccess={vi.fn()} onCancel={vi.fn()} />);
  const telefono = screen.getByLabelText("Teléfono");
  expect(telefono.getAttribute("type")).toBe("tel");
  expect(telefono.getAttribute("inputmode")).toBe("tel");
});

it("el error de la tarifa se anuncia y queda atado al campo", async () => {
  render(<EditarPacienteForm paciente={{ ...PACIENTE, tarifa: 0 }} onSuccess={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  const mensaje = await screen.findByRole("alert");
  const campo = screen.getByRole("spinbutton");
  expect(campo.getAttribute("aria-invalid")).toBe("true");
  expect(campo.getAttribute("aria-describedby")).toBe(mensaje.id);
});

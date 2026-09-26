// @vitest-environment jsdom

// Debajo de la hora, la misma hora con su franja. En producción un turno de
// las 10:58 de la mañana quedó a las 22:58: el selector de Android abrió en
// PM (la propuesta venía de un turno de las 22:00) y "10:58" no decía que era
// de noche. De noche o de madrugada, la línea avisa; no bloquea.

import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { expect, it } from "vitest";

import {
  CAMPOS_TURNO_DEFAULT,
  TurnoEditarCampos,
  type CamposTurnoValores,
} from "@/components/forms/turno-editar-campos";

function Formulario({ hora }: { hora: string }) {
  const form = useForm<CamposTurnoValores>({
    defaultValues: { ...CAMPOS_TURNO_DEFAULT, hora },
  });
  return (
    <FormProvider {...form}>
      <TurnoEditarCampos />
    </FormProvider>
  );
}

const AVISO = /Revisá si es de mañana o de noche/;

it("a las 22:58 dice que es de noche y avisa", () => {
  render(<Formulario hora="22:58" />);

  const linea = screen.getByText(/10:58 de la noche/);
  expect(linea).toHaveProperty("textContent", "10:58 de la noche. Revisá si es de mañana o de noche.");
  expect(linea.className).toContain("text-terracotta-500");
  expect(screen.getByLabelText("Hora").getAttribute("aria-describedby")).toBe(linea.id);
});

it("a las 10:58 dice que es de mañana, sin aviso", () => {
  render(<Formulario hora="10:58" />);

  const linea = screen.getByText("10:58 de la mañana");
  expect(linea.className).toContain("text-ink-500");
  expect(screen.queryByText(AVISO)).toBeNull();
});

it("la línea sigue a lo que se escribe y desaparece si el campo queda vacío", () => {
  render(<Formulario hora="10:58" />);
  const hora = screen.getByLabelText("Hora");

  fireEvent.change(hora, { target: { value: "22:58" } });
  expect(screen.getByText(AVISO)).toBeTruthy();

  fireEvent.change(hora, { target: { value: "" } });
  expect(screen.queryByText(/de la (mañana|tarde|noche|madrugada)/)).toBeNull();
  expect(hora.getAttribute("aria-describedby")).toBeNull();
});

// @vitest-environment jsdom
//
// El "procesando" con Lupita sentada (06-lupita-presencia.md): sólo si quien
// lo dibuja lo pide. Por defecto, el anillo de siempre, porque este renglón
// también sale en la card de ahora, en la ficha y en la nota.

import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { IndicadorProcesando } from "@/components/ui/procesando";

it("por defecto, el anillo girando y ninguna Lupita", () => {
  const { container } = render(<IndicadorProcesando paciente="Ana Pérez" />);
  expect(container.querySelector(".gira-procesando")).not.toBeNull();
  expect(container.querySelector("svg[data-pose]")).toBeNull();
});

it("con conLupita, Lupita concentrada a 32 px en el lugar del anillo", () => {
  const { container } = render(<IndicadorProcesando paciente="Ana Pérez" conLupita />);
  expect(container.querySelector(".gira-procesando")).toBeNull();
  const lupita = container.querySelector("svg[data-pose]")!;
  expect(lupita.getAttribute("data-pose")).toBe("concentrada");
  expect(lupita.getAttribute("width")).toBe("32");
  expect(lupita.getAttribute("aria-hidden")).toBe("true");
});

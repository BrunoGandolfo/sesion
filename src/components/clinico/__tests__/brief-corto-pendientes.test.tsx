// @vitest-environment jsdom
//
// El resumen corto no recorta en silencio: si hay una nota o una propuesta
// que todavía no entró en lo que se muestra, lo dice y ofrece preparar la
// sesión.
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { BriefCorto } from "../brief-corto";

const ULTIMA = {
  fecha: "2026-09-10T15:00:00Z",
  resumenSesion: "Habló del trabajo y de la relación con su madre.",
  focoProximaSesion: "Retomar el conflicto con el jefe.",
  riesgo: { nivel: "ninguno" as const, flagsActivos: [], indicadores: [] },
};

it("avisa cuando hay una nota sin revisar que el resumen no incluye, y ofrece Preparar sesión", () => {
  render(<BriefCorto ultimaSesion={ULTIMA} pacienteId="p1" notaPendiente />);

  expect(screen.getByText(/nota sin revisar/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Preparar sesión" }).getAttribute("href")).toBe("/pacientes/p1?preparar=1");
});

it("avisa cuando el Recorrido tiene una propuesta sin revisar", () => {
  render(<BriefCorto ultimaSesion={ULTIMA} pacienteId="p1" propuestaPendiente />);

  expect(screen.getByText(/propuesta sin revisar/)).toBeTruthy();
});

it("sin nada pendiente no agrega ningún aviso", () => {
  render(<BriefCorto ultimaSesion={ULTIMA} pacienteId="p1" />);

  expect(screen.queryByText(/sin revisar/)).toBeNull();
});

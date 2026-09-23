// @vitest-environment jsdom
//
// Un solo nombre para el resumen previo: "Preparar sesión", el mismo en Hoy,
// en el detalle del turno de Agenda y en la ficha. El nombre viejo no queda
// en ningún archivo de src/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { BriefCortoDePaciente } from "../brief-corto";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn().mockResolvedValue({
    pacienteId: "p1",
    ultimaSesion: null,
    hiloLongitudinal: null,
  }),
  esAbort: () => false,
}));

// Armado por partes para que este archivo no sea el que el test encuentra.
const NOMBRE_VIEJO = ["Para", "retomar"].join(" ");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

it("el resumen del detalle del turno se llama Preparar sesión", async () => {
  let contenedor!: HTMLElement;
  await act(async () => {
    ({ container: contenedor } = render(<BriefCortoDePaciente pacienteId="p1" />));
  });
  expect(screen.getByRole("heading", { name: "Preparar sesión" })).toBeTruthy();
  // Como rótulo; "no hay recorrido para retomar", en minúscula, es la misma
  // frase que dice la ficha cuando no hay nada.
  expect(contenedor.textContent).not.toContain(NOMBRE_VIEJO);
});

it(`«${NOMBRE_VIEJO}» no aparece en ningún archivo de src/`, () => {
  const conElNombre = archivos(join(process.cwd(), "src")).filter((ruta) =>
    readFileSync(ruta, "utf8").includes(NOMBRE_VIEJO),
  );
  expect(conElNombre).toEqual([]);
});

// @vitest-environment jsdom
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { hiloVacio, type ContenidoHilo } from "@/lib/hilo/contenido";
import { HiloContenido } from "../HiloContenido";

const secciones = [
  ["hipotesisDiagnostica", "Hipótesis clínica"],
  ["resumenAcumulativo", "El recorrido hasta hoy"],
  ["objetivosTerapeuticos", "Objetivos"],
  ["intervencionesProbadas", "Intervenciones"],
  ["temasRecurrentes", "Temas recurrentes"],
  ["riesgosHistoricos", "Señales anteriores"],
] as const;

const contenido: ContenidoHilo = {
  ...hiloVacio(),
  hipotesisDiagnostica: "Hipótesis revisada",
  resumenAcumulativo: "Primer encuentro.\n\nSegundo encuentro.\nUna observación adicional.",
  objetivosTerapeuticos: [{ id: "objetivo", descripcion: "Reconocer emociones", estado: "activo", fechaInicio: "2026-09-01", fechaCierre: null }],
  intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "alta", sesiones: [] }],
  temasRecurrentes: [{ tema: "Vínculos", conteo: 2 }],
  riesgosHistoricos: [{ sesionId: "7b0c7e0a-1c4e-4d8a-9a51-0f5d7a9b2c11", fecha: "2026-09-01", flag: "autolesion", detalle: "Mención en la sesión" }],
};

it("sin filtro imprime las seis secciones y conserva los cortes entre párrafos", () => {
  render(<HiloContenido contenido={contenido} />);
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual(secciones.map(([, titulo]) => titulo));
  for (const [campo, titulo] of secciones) {
    const encabezado = screen.getByRole("heading", { name: titulo });
    expect(encabezado.classList.contains("break-after-avoid")).toBe(true);
    expect(encabezado.closest("section")!.classList.contains("break-inside-avoid")).toBe(campo !== "resumenAcumulativo");
  }
  const primero = screen.getByText("Primer encuentro.");
  const segundo = screen.getByText("Segundo encuentro. Una observación adicional.");
  for (const parrafo of [primero, segundo]) {
    expect(parrafo.tagName).toBe("P");
    expect(parrafo.classList.contains("break-inside-avoid")).toBe(true);
    expect(parrafo.classList.contains("whitespace-pre-wrap")).toBe(true);
  }
  expect(segundo.textContent).toBe("Segundo encuentro.\nUna observación adicional.");
  expect(screen.getByText("Vínculos · 2 sesiones").closest("li")!.classList.contains("break-inside-avoid")).toBe(true);
});

it.each(secciones)("la comparación de %s muestra únicamente esa sección y sus cambios", (campo, titulo) => {
  const { rerender } = render(<HiloContenido solo={campo} contenido={contenido} anterior={hiloVacio()} />);
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  expect(screen.getByRole("heading").textContent).toBe(`${titulo}Con cambios`);
  rerender(<HiloContenido solo={campo} contenido={contenido} anterior={contenido} />);
  expect(screen.queryByText("Con cambios")).toBeNull();
});

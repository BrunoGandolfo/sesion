// @vitest-environment jsdom
import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

// ── En pantalla: mismo contenido, otro orden ────────────────────────────────

it("en pantalla abre con objetivos e hipótesis y deja el relato acumulado plegado al final", () => {
  const { container } = render(<HiloContenido pantalla contenido={contenido} />);
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual([
    "Objetivos", "Hipótesis clínica", "Temas recurrentes", "Intervenciones", "Señales anteriores",
  ]);
  const relato = container.querySelector("details")!;
  expect(relato.open).toBe(false);
  expect(relato.querySelector("summary")!.textContent).toBe("El recorrido hasta hoy · un párrafo por sesión");
  // Sigue disponible, entero, adentro del plegable; y es lo último.
  expect(within(relato).getByText("Primer encuentro.")).toBeTruthy();
  expect(container.firstElementChild!.lastElementChild).toBe(relato);
  // Lo primero que se lee es un objetivo, no un párrafo de sesión.
  expect(container.firstElementChild!.firstElementChild!.textContent).toContain("Reconocer emociones");
});

it("en pantalla una sección sin contenido lo dice; en el papel queda como estaba", () => {
  const { container, rerender } = render(<HiloContenido pantalla contenido={hiloVacio()} />);
  for (const texto of ["Sin objetivos registrados.", "Sin intervenciones registradas.", "Sin temas registrados.", "Sin señales anteriores."]) {
    expect(screen.getByText(texto)).toBeTruthy();
  }
  rerender(<HiloContenido contenido={hiloVacio()} />);
  expect(screen.queryByText("Sin objetivos registrados.")).toBeNull();
  expect(container.querySelectorAll("ul")).toHaveLength(4);
});

it("al comparar una propuesta en pantalla, el relato va abierto y con su marca de cambios", () => {
  const { container } = render(<HiloContenido pantalla solo="resumenAcumulativo" contenido={contenido} anterior={hiloVacio()} />);
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByRole("heading").textContent).toBe("El recorrido hasta hoyCon cambios");
});

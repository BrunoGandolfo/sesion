// @vitest-environment jsdom
// Terracota es deuda o riesgo, nada más (docs/diseno/01-tokens.md). En el
// gráfico de intensidad, sólo los puntos de sesiones con señal van en
// terracota; la serie, en neutro. Y las intervenciones se nombran con su
// tilde, también las que no están en el contrato.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SUBTITULO_INTENSIDAD } from "@/lib/glosario";

import { COLOR } from "../base";
import { IntensidadChart } from "../intensidad";
import { IntervencionesChart } from "../intervenciones";
import type { SesionProgreso } from "../progreso-contrato";

afterEach(cleanup);

function sesion(dia: number, cambios: Partial<SesionProgreso> = {}): SesionProgreso {
  return {
    sesionId: `s${dia}`,
    fecha: new Date(Date.UTC(2026, 8, dia, 15)).toISOString(),
    numero: dia,
    intensidadEmocional: (dia % 9) + 1,
    alianzaTerapeutica: null,
    temas: [],
    nivelRiesgo: "ninguno",
    flagsRiesgo: {} as SesionProgreso["flagsRiesgo"],
    intervenciones: {},
    observacionIA: null,
    progresoPercibido: null,
    ...cambios,
  };
}

/** Todo lo que lleva terracota dentro del SVG: relleno o trazo. */
function terracotas(svg: Element): Element[] {
  return Array.from(svg.querySelectorAll("*")).filter((el) =>
    ["fill", "stroke"].some((attr) => (el.getAttribute(attr) ?? "").includes("terracotta")),
  );
}

function grafico() {
  return screen.getByRole("img", { name: /Intensidad emocional/ });
}

describe("intensidad: terracota sólo en las sesiones con señal", () => {
  it("con una sola sesión con señal, exactamente un punto terracota y el resto neutro", () => {
    const sesiones = [1, 3, 5, 8, 10].map((dia) =>
      sesion(dia, dia === 5 ? { nivelRiesgo: "alto" } : {}),
    );
    render(<IntensidadChart sesiones={sesiones} />);
    const svg = grafico();

    const marcados = terracotas(svg);
    expect(marcados).toHaveLength(1);
    expect(marcados[0].tagName).toBe("circle");
    expect(marcados[0].getAttribute("fill")).toBe(COLOR.terracotta);
    expect(marcados[0].querySelector("title")?.textContent).toContain("5 sep");

    // Los otros puntos, la línea y el área, en neutro.
    const circulos = Array.from(svg.querySelectorAll("circle"));
    expect(circulos).toHaveLength(5);
    const neutros = circulos.filter((c) => c !== marcados[0]);
    for (const c of neutros) expect(c.getAttribute("fill")).toBe(COLOR.ink);
    // El destacado es más grande que los demás.
    expect(Number(marcados[0].getAttribute("r"))).toBeGreaterThan(Number(neutros[0].getAttribute("r")));
    expect(svg.querySelector("polyline")?.getAttribute("stroke")).toBe(COLOR.ink);
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe(COLOR.inkArea);
  });

  it("una señal por flag, sin nivel, también se marca", () => {
    const sesiones = [1, 2, 3].map((dia) =>
      sesion(dia, dia === 2 ? { nivelRiesgo: null, flagsRiesgo: { autolesion: true } as SesionProgreso["flagsRiesgo"] } : {}),
    );
    render(<IntensidadChart sesiones={sesiones} />);
    expect(terracotas(grafico())).toHaveLength(1);
  });

  it("sin sesiones con señal, ningún terracota en el gráfico", () => {
    render(<IntensidadChart sesiones={[1, 3, 5, 8, 10].map((dia) => sesion(dia))} />);
    expect(terracotas(grafico())).toEqual([]);
  });

  it("la leyenda dice terracota", () => {
    render(<IntensidadChart sesiones={[sesion(1)]} />);
    expect(screen.getByText(SUBTITULO_INTENSIDAD).textContent).toContain("Los puntos en terracota");
    expect(document.body.textContent).not.toMatch(/terracotta/i);
  });
});

describe("intervenciones: etiquetas con tilde", () => {
  it("nombra Psicoeducación y Validación con su tilde, y ninguna clave cruda", () => {
    const sesiones = [
      sesion(1, { intervenciones: { validacion: 2, psicoeducacion: 1 } }),
      sesion(2, { intervenciones: { pregunta_circular: 1, silencio_terapeutico: 1, senalamiento: 1 } }),
    ];
    render(<IntervencionesChart sesiones={sesiones} />);
    const leyenda = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(leyenda).toEqual(
      expect.arrayContaining(["Validación", "Psicoeducación", "Pregunta circular", "Silencio terapéutico", "Señalamiento"]),
    );
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/Psicoeducacion|Validacion|Senalamiento|pregunta_circular|silencio_terapeutico/);
  });
});

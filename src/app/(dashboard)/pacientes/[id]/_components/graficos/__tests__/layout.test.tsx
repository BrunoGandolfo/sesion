// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarrasPorFecha, LineaPorFecha, type PuntoLinea } from "../base";

let redimensionar: (ancho: number) => void;
const desconectar = vi.fn();
beforeEach(() => {
  desconectar.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {
      redimensionar = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect = desconectar;
  });
});
afterEach(() => vi.unstubAllGlobals());
const fecha = (dia: number) => new Date(Date.UTC(2026, 8, dia, 15));
function linea(puntos: PuntoLinea[]) {
  return <LineaPorFecha puntos={puntos} yMin={0} yMax={10} yTicks={[0, 5, 10]} color="#000" fillColor="#ddd" ariaLabel="Evolución" />;
}
function verificarRotulos(svg: Element, ancho: number) {
  const rotulos = Array.from(svg.querySelectorAll('[data-eje="x"]'));
  expect(rotulos.length).toBeGreaterThan(0);
  let finAnterior = 0;
  for (const rotulo of rotulos) {
    const mitad = (rotulo.textContent?.length ?? 0) * 7.5 / 2;
    const centro = Number(rotulo.getAttribute("x"));
    expect(centro - mitad).toBeGreaterThanOrEqual(finAnterior);
    expect(centro + mitad).toBeLessThanOrEqual(ancho - 16);
    expect(rotulo.getAttribute("font-size")).toBe("12");
    finAnterior = centro + mitad + 12;
  }
}

describe("gráficos legibles dentro de una pantalla de 390 px", () => {
  it("conserva 12 px de texto y separa rótulos al pasar de una tarjeta móvil a escritorio", () => {
    const puntos = Array.from({ length: 40 }, (_, i) => ({ fecha: fecha(i + 1), valor: i % 10 }));
    const { unmount } = render(linea(puntos));
    const svg = screen.getByRole("img", { name: "Evolución" });
    for (const ancho of [290, 900]) {
      act(() => redimensionar(ancho));
      expect(svg.getAttribute("viewBox")).toBe(`0 0 ${ancho} 220`);
      expect(svg.getAttribute("height")).toBe("220");
      expect(svg.getAttribute("class")).not.toContain("min-w");
      expect(svg.parentElement?.className).not.toContain("overflow-x");
      verificarRotulos(svg, ancho);
      for (const texto of svg.querySelectorAll("text")) expect(texto.getAttribute("font-size")).toBe("12");
    }
    unmount();
    expect(desconectar).toHaveBeenCalledOnce();
  });

  it("rotula una sola vez el día de Montevideo aunque cruce medianoche UTC, sin quitar sesiones", () => {
    render(linea(["2026-09-05T22:00:00Z", "2026-09-06T01:00:00Z", "2026-09-06T02:00:00Z"].map((valor, i) => ({ fecha: new Date(valor), valor: i + 1 }))));
    const svg = screen.getByRole("img");
    act(() => redimensionar(290));
    expect(svg.querySelectorAll('[data-eje="x"]')).toHaveLength(1);
    expect(svg.querySelector('[data-eje="x"]')?.textContent).toBe("5 sep");
    expect(svg.querySelectorAll("circle")).toHaveLength(3);
  });

  it("mantiene los cortes sin dato y los marcadores de riesgo al ajustar el ancho", () => {
    const puntos = Array.from({ length: 20 }, (_, i) => ({ fecha: fecha(i + 1), valor: i === 9 ? null : 5, destacado: i === 4, detalle: `Sesión ${i}` }));
    render(linea(puntos));
    act(() => redimensionar(290));
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("polyline")).toHaveLength(2);
    expect(svg.querySelectorAll("circle")).toHaveLength(3);
    expect(svg.querySelector('circle[r="4.5"] title')?.textContent).toBe("Sesión 4");
    expect(svg.querySelectorAll("polyline")[0].getAttribute("points")?.split(" ")).toHaveLength(9);
  });

  it("acomoda todas las barras y su leyenda sin ensanchar el gráfico ni repetir fechas", () => {
    const barras = Array.from({ length: 120 }, (_, i) => ({ fecha: fecha(Math.floor(i / 3) + 1), valores: { escucha: 2 } }));
    render(<BarrasPorFecha barras={barras} claves={["escucha"]} etiquetas={{ escucha: "Escucha" }} colores={{ escucha: "#000" }} yTicks={[0, 2]} yMax={2} ariaLabel="Intervenciones" />);
    act(() => redimensionar(290));
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("viewBox")).toBe("0 0 290 240");
    const rectangulos = Array.from(svg.querySelectorAll("rect"));
    expect(rectangulos).toHaveLength(120);
    let finAnterior = 36;
    for (const rectangulo of rectangulos) {
      const x = Number(rectangulo.getAttribute("x"));
      const ancho = Number(rectangulo.getAttribute("width"));
      expect(ancho).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(finAnterior);
      finAnterior = x + ancho;
    }
    expect(finAnterior).toBeLessThan(274);
    verificarRotulos(svg, 290);
    const textos = Array.from(svg.querySelectorAll('[data-eje="x"]'), (n) => n.textContent);
    expect(new Set(textos).size).toBe(textos.length);
    expect(screen.getByText("Escucha")).toBeTruthy();
  });
});

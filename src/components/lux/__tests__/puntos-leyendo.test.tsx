// @vitest-environment jsdom
//
// Los puntos de "Lux está leyendo": se encienden de a uno en un ciclo de
// 1,2 s hecho con los tiempos de movimiento.ts; con movimiento reducido
// quedan fijos. El sol, quieto siempre.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Lux } from "@/components/ui/lux";
import { LUX_LEYENDO } from "@/lib/glosario";
import { TIEMPOS } from "@/lib/movimiento";

const m = vi.hoisted(() => ({ reducido: false }));
vi.mock("@/hooks/useMovimientoReducido", () => ({ useMovimientoReducido: () => m.reducido }));

import { CICLO_LEYENDO_MS, PuntosLeyendo, tramoDelPunto } from "../puntos-leyendo";

afterEach(() => { m.reducido = false; });

describe("los puntos de Lux está leyendo", () => {
  it("el ciclo dura 1,2 s y sale de movimiento.ts", () => {
    expect(CICLO_LEYENDO_MS).toBe(3 * (TIEMPOS.pliegue + TIEMPOS.navegacion));
    expect(CICLO_LEYENDO_MS).toBe(1200);
  });

  it("se encienden de a uno, en orden, cada uno en un pliegue", () => {
    const tramos = [0, 1, 2].map(tramoDelPunto);
    expect(tramos.map((t) => t.empieza)).toEqual([0, 400 / 1200, 800 / 1200]);
    for (const t of tramos) expect((t.encendido - t.empieza) * CICLO_LEYENDO_MS).toBeCloseTo(TIEMPOS.pliegue);
    expect(tramos[2].encendido).toBeLessThan(1);
  });

  it("con movimiento: tres puntos que se animan, decorativos y en el color del texto", () => {
    const { container } = render(<p className="text-ink-500">{LUX_LEYENDO}<PuntosLeyendo /></p>);
    const puntos = container.querySelector('[data-puntos="encendiendo"]')!;
    expect(puntos.getAttribute("aria-hidden")).toBe("true");
    expect(puntos.children).toHaveLength(3);
    // Sin color propio: heredan el del texto.
    expect(puntos.outerHTML).not.toMatch(/color|text-/);
    expect(container.textContent).toBe("Lux está leyendo...");
  });

  it("con movimiento reducido los puntos quedan fijos", () => {
    m.reducido = true;
    const { container } = render(<PuntosLeyendo />);
    expect(container.querySelector('[data-puntos="quietos"]')?.textContent).toBe("...");
    expect(container.querySelector('[data-puntos="encendiendo"]')).toBeNull();
  });

  it("el sol sigue quieto: no tiene animación ni movimiento", () => {
    const { container } = render(<Lux />);
    expect(container.innerHTML).not.toMatch(/animate|transition|motion|style=/);
  });
});

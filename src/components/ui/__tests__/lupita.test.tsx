// @vitest-environment jsdom
//
// El primer test de componente del repo. La línea de arriba no es un
// comentario: es lo que le dice a vitest que este archivo corre en un DOM y
// no en node. Sin ella, `render` explota con "document is not defined".
// Ver la nota de vitest.config.ts.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Lupita, TAMANOS_LUPITA, type PoseLupita } from "@/components/ui/lupita";

const POSES: PoseLupita[] = ["saluda", "senala", "celebra"];

function dibujar(pose: PoseLupita, tamano?: number) {
  const { container } = render(<Lupita pose={pose} tamano={tamano} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error(`la pose ${pose} no dibujó nada`);
  return svg;
}

describe("Lupita", () => {
  it("dibuja las tres poses", () => {
    for (const pose of POSES) {
      const svg = dibujar(pose);
      expect(svg.getAttribute("data-pose")).toBe(pose);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      // Tallo, hoja grande y hoja chica: las dos hojas y media.
      expect(svg.querySelectorAll("path")).toHaveLength(3);
    }
  });

  it("dibuja cada pose distinta de las otras dos", () => {
    const dibujos = POSES.map((pose) => dibujar(pose).innerHTML);
    expect(new Set(dibujos).size).toBe(POSES.length);
  });

  it("es siempre decorativa: aria-hidden y sin foco", () => {
    for (const pose of POSES) {
      const svg = dibujar(pose);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      // Nada de texto accesible: el que habla es el texto de al lado.
      expect(svg.querySelector("title")).toBeNull();
    }
  });

  it("dibuja los tres tamaños documentados", () => {
    for (const tamano of Object.values(TAMANOS_LUPITA)) {
      const svg = dibujar("saluda", tamano);
      expect(svg.getAttribute("width")).toBe(String(tamano));
      expect(svg.getAttribute("height")).toBe(String(tamano));
    }
  });

  it("saca el punto dorado del brote a 20 px, donde ensucia", () => {
    expect(dibujar("celebra", TAMANOS_LUPITA.inline).querySelector("[data-brote]")).toBeNull();
    expect(
      dibujar("celebra", TAMANOS_LUPITA.encabezado).querySelector("[data-brote]"),
    ).not.toBeNull();
    expect(
      dibujar("celebra", TAMANOS_LUPITA.vacio).querySelector("[data-brote]"),
    ).not.toBeNull();
  });

  it("conserva la pose cuando recibe cada movimiento con significado", () => {
    const movimientos = ["entra", "piensa", "celebra"] as const;
    for (const movimiento of movimientos) {
      const { container } = render(
        <Lupita
          pose={movimiento === "celebra" ? "celebra" : "senala"}
          movimiento={movimiento}
        />,
      );
      expect(container.querySelector("[data-pose]")).not.toBeNull();
    }
  });
});

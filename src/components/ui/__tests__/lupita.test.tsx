// @vitest-environment jsdom
//
// El primer test de componente del repo. La línea de arriba no es un
// comentario: es lo que le dice a vitest que este archivo corre en un DOM y
// no en node. Sin ella, `render` explota con "document is not defined".
// Ver la nota de vitest.config.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { Lupita, LupitaMenu, TAMANOS_LUPITA, type PoseLupita } from "@/components/ui/lupita";

const preferencias = vi.hoisted(() => ({ reducido: false }));
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  return {
    ...original,
    useReducedMotion: () => preferencias.reducido,
    motion: {
      path: original.motion.path,
      span: ({ children, animate, initial, transition, ...props }: import("react").ComponentProps<"span"> & {
        animate?: unknown; initial?: unknown; transition?: unknown;
      }) => <span {...props} data-motion-span="true" data-animate={JSON.stringify(animate)}
        data-initial={JSON.stringify(initial)} data-transition={JSON.stringify(transition)}>{children}</span>,
    },
  };
});
beforeEach(() => { preferencias.reducido = false; });

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
    const movimientos = ["brota", "respira", "piensa", "habla", "celebra", "quieta"] as const;
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

const MOVIMIENTOS = ["brota", "respira", "piensa", "habla", "celebra", "quieta"] as const;

it("cada movimiento tiene un animate distinto en motion.span", () => {
  const animaciones = MOVIMIENTOS.map((movimiento) => {
    const { container } = render(<Lupita pose="saluda" movimiento={movimiento} />);
    const span = container.querySelector("[data-motion-span]");
    expect(span).not.toBeNull();
    return span!.getAttribute("data-animate");
  });
  expect(new Set(animaciones).size).toBe(MOVIMIENTOS.length);
});

it.each(MOVIMIENTOS)("con movimiento reducido %s muestra sólo la pose fija", (movimiento) => {
  preferencias.reducido = true;
  const { container } = render(<Lupita pose="saluda" movimiento={movimiento} />);
  expect(container.querySelector("span")).toBeNull();
  expect(container.querySelector("svg")?.getAttribute("data-pose")).toBe(
    movimiento === "piensa" ? "senala" : movimiento === "celebra" ? "celebra" : "saluda",
  );
});

it("cada fragmento reinicia el bob de habla sin activar un loop", () => {
  const { container, rerender } = render(<Lupita pose="saluda" movimiento="habla" pulso={1} />);
  const primero = container.querySelector("[data-motion-span]");
  expect(JSON.parse(primero!.getAttribute("data-animate")!)).toEqual({ scale: 1, rotate: 0, y: [0, -2, 0] });
  expect(JSON.parse(primero!.getAttribute("data-transition")!)).toEqual({ duration: 0.15, ease: "easeInOut" });
  rerender(<Lupita pose="saluda" movimiento="habla" pulso={2} />);
  expect(container.querySelector("[data-motion-span]")).not.toBe(primero);
});

it("el menú hace un bob de 3 px por toque, sin loop ni movimiento reducido", () => {
  const { container, rerender } = render(<LupitaMenu toque={0} />);
  const antes = container.firstElementChild;
  expect(JSON.parse(antes!.getAttribute("data-animate")!)).toEqual({ y: 0 });
  rerender(<LupitaMenu toque={1} />);
  expect(container.firstElementChild).not.toBe(antes);
  expect(JSON.parse(container.firstElementChild!.getAttribute("data-animate")!)).toEqual({ y: [0, -3, 0] });
  expect(JSON.parse(container.firstElementChild!.getAttribute("data-transition")!)).toEqual({ duration: 0.15, ease: "easeInOut" });
  preferencias.reducido = true;
  rerender(<LupitaMenu toque={2} />);
  expect(container.querySelector("span")).toBeNull();
});

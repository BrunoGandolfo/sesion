// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo que
// lo hace correr en un DOM.
//
// Qué se verifica acá: que con `prefers-reduced-motion: reduce` puesto, las
// dos piezas que más se abren en el día —el sheet y el toast— no se muevan.
// No "se muevan menos": no se muevan. Es la regla que declara la cabecera de
// movimiento.tsx y la que 03-plan-de-movimiento.md pide terminar de cumplir
// en D1 y D2.
//
// La preferencia se simula mockeando window.matchMedia ANTES del primer
// render del archivo: framer-motion se suscribe a la media query una sola vez
// por módulo, así que un archivo de test no puede tener las dos preferencias.
// Por eso el caso contrario —el foco de Confirmar esperando al despliegue—
// vive en confirmar.test.tsx.

import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

import { Confirmar } from "@/components/ui/confirmar";
import { Sheet } from "@/components/ui/sheet";
import { Toast } from "@/components/ui/toast";

// framer-motion consulta "(prefers-reduced-motion)" a secas y el CSS de
// globals.css "(prefers-reduced-motion: reduce)": el mock contesta que sí a
// las dos formas.
const CONSULTA_REDUCIDO = "prefers-reduced-motion";

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes(CONSULTA_REDUCIDO),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
});

/** framer-motion escribe las transformaciones en el `style` del elemento. Si
 *  no hay nada ahí, no hay desplazamiento ni escala: el panel está o no
 *  está. */
function transformDe(el: HTMLElement): string {
  return el.style.transform ?? "";
}

describe("Sheet con movimiento reducido", () => {
  it("abre los paneles sin desplazamiento ni escala", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="Cobrar">
        <button type="button">Efectivo</button>
      </Sheet>,
    );

    // El sheet monta el panel de mobile y el de desktop a la vez y esconde
    // uno con CSS, que en jsdom no corre: se miran los dos.
    const paneles = screen.getAllByRole("dialog");
    expect(paneles).toHaveLength(2);
    for (const panel of paneles) {
      expect(transformDe(panel)).toBe("");
    }
  });

  it("deja el overlay sin fundido, pero lo deja", () => {
    const { container } = render(
      <Sheet open onClose={() => {}} ariaLabel="Cobrar">
        <button type="button">Efectivo</button>
      </Sheet>,
    );

    const overlay = document.body.querySelector<HTMLElement>(
      '[aria-hidden="true"]',
    );
    expect(overlay).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    // Sin opacidad de arranque: se ve entero desde el primer cuadro.
    expect(overlay?.style.opacity ?? "").toBe("");
  });

  it("sigue siendo un diálogo modal: la preferencia no toca el foco", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="Cobrar">
        <button type="button">Efectivo</button>
      </Sheet>,
    );

    // El atrapado de foco en sí no se puede ejercitar en jsdom —el sheet
    // elige el panel visible con getClientRects() y sin layout no hay
    // ninguno—, pero lo que sostiene el contrato del diálogo sí se ve:
    // aria-modal y el rótulo siguen ahí con la preferencia puesta.
    for (const panel of screen.getAllByRole("dialog")) {
      expect(panel.getAttribute("aria-modal")).toBe("true");
      expect(panel.getAttribute("aria-label")).toBe("Cobrar");
      expect(panel.getAttribute("tabindex")).toBe("-1");
    }
  });
});

describe("Toast con movimiento reducido", () => {
  it("entra sin desplazamiento", () => {
    render(<Toast open message="Cobrado. Ese ya está." onClose={() => {}} />);

    const toast = screen.getByRole("status");
    expect(transformDe(toast)).toBe("");
    expect(toast.textContent).toContain("Cobrado. Ese ya está.");
  });

  it("confirma con el check, y nunca con Lupita", () => {
    const { container } = render(
      <Toast open message="Cobrado. Ese ya está." onClose={() => {}} />,
    );

    // El cobro se confirma con el trazo del check. Lupita no entra acá: el
    // toast se dibuja sobre ink-900 y su paleta está fijada sobre blanco o
    // crema (docs/diseno/04-personaje.md). El tono alegre lo pone la frase.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-pose]")).toBeNull();
  });

  it("no le pone un tilde verde a un fallo", () => {
    const { container } = render(
      <Toast
        open
        message="No se pudo cobrar. Probá de nuevo."
        onClose={() => {}}
        variante="aviso"
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("Confirmar con movimiento reducido", () => {
  it("pone el foco en Cancelar en el acto: no hay despliegue que esperar", () => {
    render(
      <Confirmar
        titulo="¿Cancelar este turno?"
        accion="Cancelar el turno"
        onConfirmar={() => {}}
        onCancelar={() => {}}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancelar" }),
    );
  });
});

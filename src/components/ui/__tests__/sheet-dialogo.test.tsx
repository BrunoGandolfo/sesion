// @vitest-environment jsdom
//
// El Sheet es un diálogo: se cierra con Escape, el Tab no se escapa del panel
// y el foco vuelve a quien lo abrió. Eso no estaba probado en ningún lado, y
// es justo lo que se puede romper al tocar cómo se monta el panel.
//
// jsdom no calcula geometría: `getClientRects()` devuelve una lista vacía
// para todo. Como el sheet usaba esa señal para elegir cuál de sus dos
// paneles estaba a la vista, sin este doble el foco no se movía nunca. Se
// repone acá para que la prueba hable del comportamiento real del navegador.
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Sheet } from "../sheet";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
});

/** El panel que ve el teléfono: con un solo panel montado, es el único. */
function panel() {
  return document.querySelectorAll<HTMLElement>('[role="dialog"]')[0];
}

describe("Sheet como diálogo", () => {
  it("Escape lo cierra", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} ariaLabel="Detalle">
        <button>Uno</button>
      </Sheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("al abrir, el foco entra al panel", () => {
    render(
      <Sheet open onClose={vi.fn()} ariaLabel="Detalle">
        <button>Uno</button>
        <button>Dos</button>
      </Sheet>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Uno" }));
  });

  it("Tab y Shift+Tab circulan dentro del panel", () => {
    render(
      <Sheet open onClose={vi.fn()} ariaLabel="Detalle">
        <button>Uno</button>
        <button>Dos</button>
      </Sheet>,
    );

    const uno = screen.getByRole("button", { name: "Uno" });
    const dos = screen.getByRole("button", { name: "Dos" });

    // Desde el último, Tab vuelve al primero.
    dos.focus();
    fireEvent.keyDown(panel(), { key: "Tab" });
    expect(document.activeElement).toBe(uno);

    // Desde el primero, Shift+Tab va al último.
    fireEvent.keyDown(panel(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dos);
  });

  it("el foco vuelve a quien lo abrió al cerrar", () => {
    function Pantalla() {
      const [abierto, setAbierto] = React.useState(false);
      return (
        <>
          <button onClick={() => setAbierto(true)}>Abrir</button>
          <Sheet open={abierto} onClose={() => setAbierto(false)} ariaLabel="Detalle">
            <button>Uno</button>
          </Sheet>
        </>
      );
    }

    render(<Pantalla />);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    abrir.focus();
    fireEvent.click(abrir);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Uno" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(abrir);
  });

  it("monta su contenido una sola vez", () => {
    render(
      <Sheet open onClose={vi.fn()} ariaLabel="Detalle">
        <button>Uno</button>
      </Sheet>,
    );

    expect(screen.getAllByRole("button", { name: "Uno" })).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

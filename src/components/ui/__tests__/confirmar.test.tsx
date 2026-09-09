// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo que
// lo hace correr en un DOM.
//
// Este archivo corre SIN la preferencia de movimiento reducido —jsdom
// contesta que no a la media query, que es el caso de la enorme mayoría— y
// verifica lo que D8 agregó: el panel se despliega con su altura y el foco
// entra en Cancelar recién cuando terminó de desplegarse, no al montar.
//
// El caso contrario, con la preferencia puesta, vive en
// movimiento-reducido.test.tsx: framer-motion lee la media query una sola vez
// por módulo y los dos no pueden convivir en el mismo archivo.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { Confirmar } from "@/components/ui/confirmar";
import { MS_PLIEGUE } from "@/components/ui/movimiento";

function montar() {
  render(
    <Confirmar
      titulo="¿Descartar la nota?"
      mensaje="El audio ya se borró."
      accion="Descartar la nota"
      variante="peligro"
      onConfirmar={() => {}}
      onCancelar={() => {}}
    />,
  );
  return screen.getByRole("button", { name: "Cancelar" });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Confirmar", () => {
  it("no se lleva el foco mientras se está desplegando", () => {
    vi.useFakeTimers();
    const cancelar = montar();

    // Al montar, el panel todavía está abriéndose: mover el foco acá haría
    // que el navegador scrollee a una posición que en 220 ms ya no es la
    // misma.
    expect(document.activeElement).not.toBe(cancelar);
  });

  it("pone el foco en Cancelar cuando terminó de desplegarse", () => {
    vi.useFakeTimers();
    const cancelar = montar();

    act(() => {
      vi.advanceTimersByTime(MS_PLIEGUE);
    });

    // Cancelar y no la acción: quien abrió esto está a un Enter de algo que
    // no siempre se puede deshacer.
    expect(document.activeElement).toBe(cancelar);
  });

  it("sigue siendo un alertdialog con su título y su mensaje", () => {
    montar();
    const panel = screen.getByRole("alertdialog");
    const titulo = document.getElementById(
      panel.getAttribute("aria-labelledby") ?? "",
    );
    const mensaje = document.getElementById(
      panel.getAttribute("aria-describedby") ?? "",
    );
    expect(titulo?.textContent).toBe("¿Descartar la nota?");
    expect(mensaje?.textContent).toBe("El audio ya se borró.");
  });
});

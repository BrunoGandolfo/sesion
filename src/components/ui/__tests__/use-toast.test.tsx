// @vitest-environment jsdom
//
// useToast: el estado que cada pantalla escribía a mano. Lo que importa es
// lo que ella ve: el mensaje aparece con su variante, se va solo a su
// tiempo aunque la pantalla se vuelva a dibujar, y se puede cerrar.

import { act, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Toast, useToast } from "@/components/ui/toast";

// jsdom no termina las animaciones de salida: AnimatePresence dejaría el
// nodo montado. Acá se prueba el estado, no la animación.
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function Pantalla({ tic }: { tic: number }) {
  const toast = useToast();
  return (
    <div data-tic={tic}>
      <button onClick={() => toast.confirmar("Paciente creado")}>confirmar</button>
      <button onClick={() => toast.avisar("No pudimos guardar")}>avisar</button>
      <button onClick={toast.cerrar}>cerrar</button>
      <Toast {...toast.props} />
    </div>
  );
}

const tocar = (nombre: string) => fireEvent.click(screen.getByRole("button", { name: nombre }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("confirmar muestra el mensaje con el check; avisar, sin él", () => {
  const { container } = render(<Pantalla tic={0} />);
  tocar("confirmar");
  expect(screen.getByRole("status").textContent).toBe("Paciente creado");
  expect(screen.getByRole("status").querySelector("svg")).not.toBeNull();
  tocar("avisar");
  expect(screen.getByRole("status").textContent).toBe("No pudimos guardar");
  expect(container.querySelector("[role=status] svg")).toBeNull();
});

it("se va solo aunque la pantalla se redibuje en el medio", async () => {
  const { rerender } = render(<Pantalla tic={0} />);
  tocar("confirmar");
  await act(() => vi.advanceTimersByTimeAsync(1500));
  rerender(<Pantalla tic={1} />);
  await act(() => vi.advanceTimersByTimeAsync(1500));
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole("status")).toBeNull();
});

it("un aviso nuevo con el toast abierto tiene su tiempo entero", async () => {
  render(<Pantalla tic={0} />);
  tocar("confirmar");
  await act(() => vi.advanceTimersByTimeAsync(2700));
  tocar("avisar");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByRole("status").textContent).toBe("No pudimos guardar");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("cerrar lo saca en el acto", async () => {
  render(<Pantalla tic={0} />);
  tocar("confirmar");
  tocar("cerrar");
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole("status")).toBeNull();
});

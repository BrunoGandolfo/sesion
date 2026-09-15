// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResultadoSerie } from "../resultado-serie";
import type { SerieCreada } from "@/types/domain";
vi.mock("@/components/ui", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
afterEach(() => vi.useRealTimers());
const serie: SerieCreada = { id: "s1", frecuencia: "quincenal", creados: 5, omitidas: [new Date("2026-09-29T15:00:00Z"), new Date("2026-10-13T15:00:00Z")] };
it("conserva cada fecha omitida hasta que la usuaria cierra la confirmación", () => {
  vi.useFakeTimers();
  const onClose = vi.fn();
  render(<ResultadoSerie serie={serie} onClose={onClose} />);
  expect(screen.getByRole("status").textContent).toBe("5 turnos agendados");
  expect(screen.getAllByRole("listitem").map(n => n.textContent).join(" ")).toMatch(/29.*septiembre.*13.*octubre/);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("distingue la serie completa y no aparece para un turno único", () => {
  const { rerender } = render(<ResultadoSerie serie={{ ...serie, creados: 1, omitidas: [] }} onClose={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("1 turno agendado");
  expect(screen.getByText("Se agendaron todas las fechas de la serie.")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  rerender(<ResultadoSerie serie={null} onClose={vi.fn()} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

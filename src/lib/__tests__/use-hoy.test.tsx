// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { useHoy } from "@/hooks/useHoy";
import { fechaInputMvd } from "@/lib/fechas-montevideo";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("cambia de día a medianoche de Montevideo, no a medianoche UTC, sin recargar", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));
  const { result, unmount } = renderHook(() => useHoy());
  const primerValor = result.current;
  act(() => { vi.advanceTimersByTime(1000); });
  expect(result.current).toBe(primerValor);
  expect(fechaInputMvd(result.current!)).toBe("2026-12-31");
  act(() => { vi.advanceTimersByTime(3 * 60 * 60 * 1000); });
  expect(fechaInputMvd(result.current!)).toBe("2027-01-01");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("al volver de una pestaña suspendida actualiza el día y conserva el primer render neutro", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T15:00:00Z"));
  function Fecha() { const fecha = useHoy(); return fecha ? fechaInputMvd(fecha) : "sin fecha"; }
  expect(renderToString(<Fecha />)).toBe("sin fecha");
  const { result } = renderHook(() => useHoy());
  vi.setSystemTime(new Date("2027-01-02T15:00:00Z"));
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(fechaInputMvd(result.current!)).toBe("2027-01-02");
});

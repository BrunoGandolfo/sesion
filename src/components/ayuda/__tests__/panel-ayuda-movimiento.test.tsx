// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PanelAyuda } from "@/components/ayuda/panel-ayuda";
import { AYUDA_PLACEHOLDER } from "@/lib/glosario";
import { DURACION_BROTA, DURACION_CELEBRA, type LupitaProps } from "@/components/ui/lupita";

const preferencias = vi.hoisted(() => ({ reducido: false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...await importOriginal<typeof import("framer-motion")>(),
  useReducedMotion: () => preferencias.reducido,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null,
}));
vi.mock("@/components/ui/lupita", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/ui/lupita")>(),
  Lupita: ({ pose, movimiento = "quieta", tamano, pulso }: LupitaProps) => (
    <span data-testid={tamano === 72 ? "encabezado" : "inline"}
      data-pose={pose} data-movimiento={movimiento} data-pulso={pulso} />
  ),
}));

beforeEach(() => { vi.useFakeTimers(); preferencias.reducido = false; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function movimiento() { return screen.getByTestId("encabezado").getAttribute("data-movimiento"); }
function preguntar() {
  const campo = screen.getByPlaceholderText(AYUDA_PLACEHOLDER);
  fireEvent.change(campo, { target: { value: "¿Cómo hago?" } });
  fireEvent.submit(campo.closest("form")!);
}
function proveedor() {
  let flujo!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { flujo = controller; } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  return flujo;
}

it("brota al abrir, respira y vuelve a brotar al reabrir; cerrado no hay loop", async () => {
  const { rerender } = render(<PanelAyuda abierto alCerrar={() => {}} />);
  expect(movimiento()).toBe("brota");
  await act(() => vi.advanceTimersByTimeAsync(DURACION_BROTA * 1000));
  expect(movimiento()).toBe("respira");
  rerender(<PanelAyuda abierto={false} alCerrar={() => {}} />);
  expect(screen.queryByTestId("encabezado")).toBeNull();
  rerender(<PanelAyuda abierto alCerrar={() => {}} />);
  expect(movimiento()).toBe("brota");
});

it("piensa hasta el primer fragmento, pulsa por cada uno y celebra una vez", async () => {
  const flujo = proveedor();
  render(<PanelAyuda abierto alCerrar={() => {}} />);
  preguntar();
  expect(movimiento()).toBe("piensa");
  // El timer de entrada ya no puede devolverla al reposo durante la espera.
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(movimiento()).toBe("piensa");
  await act(async () => { flujo.enqueue(new TextEncoder().encode("Hola ")); });
  expect(movimiento()).toBe("habla");
  expect(screen.getByTestId("encabezado").getAttribute("data-pulso")).toBe("1");
  await act(async () => { flujo.enqueue(new TextEncoder().encode("Mariana")); });
  expect(screen.getByTestId("encabezado").getAttribute("data-pulso")).toBe("2");
  expect(screen.getAllByTestId("inline").every(nodo => nodo.getAttribute("data-movimiento") === "quieta")).toBe(true);
  await act(async () => { flujo.close(); });
  expect(movimiento()).toBe("celebra");
  await act(() => vi.advanceTimersByTimeAsync(DURACION_CELEBRA * 1000));
  expect(movimiento()).toBe("respira");
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(movimiento()).toBe("respira");
});

it("un error interrumpe la espera y vuelve al reposo sin celebrar", async () => {
  const flujo = proveedor();
  render(<PanelAyuda abierto alCerrar={() => {}} />);
  preguntar();
  await act(async () => { flujo.error(new Error("sin conexión")); });
  expect(movimiento()).toBe("respira");
});

it("con movimiento reducido mantiene señala al pensar y celebra al terminar", async () => {
  preferencias.reducido = true;
  const flujo = proveedor();
  render(<PanelAyuda abierto alCerrar={() => {}} />);
  expect(screen.getByTestId("encabezado").getAttribute("data-pose")).toBe("saluda");
  preguntar();
  expect(screen.getByTestId("encabezado").getAttribute("data-pose")).toBe("senala");
  await act(async () => { flujo.enqueue(new TextEncoder().encode("Listo.")); flujo.close(); });
  await act(() => vi.advanceTimersByTimeAsync(DURACION_CELEBRA * 1000));
  expect(screen.getByTestId("encabezado").getAttribute("data-pose")).toBe("celebra");
});

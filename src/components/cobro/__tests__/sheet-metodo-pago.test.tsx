// @vitest-environment jsdom

// El único selector de método de pago: lo que muestra y la única política
// ante un error (se queda abierto y lo dice en línea).

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import {
  AL_COBRAR_QUEDA_REALIZADO,
  COMO_PAGO,
  METODO_DE_PAGO,
  NO_SE_PUDO_COBRAR,
  VOLVER,
} from "@/lib/glosario";

import { SelectorMetodoPago, SheetMetodoPago } from "../sheet-metodo-pago";

vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

function selector(props: Partial<React.ComponentProps<typeof SelectorMetodoPago>> = {}) {
  const onListo = vi.fn();
  const onVolver = vi.fn();
  const onElegir = props.onElegir ?? vi.fn().mockResolvedValue(undefined);
  render(<SelectorMetodoPago onElegir={onElegir} onListo={onListo} onVolver={onVolver} {...props} />);
  return { onListo, onVolver, onElegir };
}

describe("SelectorMetodoPago", () => {
  it("dice el monto y, si el turno sigue programado, que cobrarlo lo marca realizado", () => {
    selector({ monto: 1800, cierraElTurno: true });
    expect(screen.getByRole("heading", { name: COMO_PAGO })).toBeTruthy();
    expect(document.body.textContent).toContain("$ 1.800");
    expect(document.body.textContent).toContain(AL_COBRAR_QUEDA_REALIZADO);
  });

  it("sin monto ni cierre no agrega nada debajo del titular", () => {
    selector();
    expect(document.body.textContent).not.toContain(AL_COBRAR_QUEDA_REALIZADO);
  });

  it("un cobro que entra llama a onListo", async () => {
    const { onListo, onElegir } = selector();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Efectivo" }));
    });
    expect(onElegir).toHaveBeenCalledWith("efectivo");
    await waitFor(() => expect(onListo).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un cobro que falla se queda abierto, dice el error de la API y deja reintentar", async () => {
    const onElegir = vi.fn()
      .mockRejectedValueOnce(new ApiClientError("El turno ya está cobrado", 400))
      .mockResolvedValueOnce(undefined);
    const { onListo } = selector({ onElegir });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Efectivo" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("El turno ya está cobrado");
    expect(onListo).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Transferencia" }));
    });
    await waitFor(() => expect(onListo).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un error que no es de la API dice NO_SE_PUDO_COBRAR, no el texto del navegador", async () => {
    selector({ onElegir: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Efectivo" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(NO_SE_PUDO_COBRAR);
  });

  it("Volver no cobra", () => {
    const { onVolver, onElegir } = selector();
    fireEvent.click(screen.getByRole("button", { name: VOLVER }));
    expect(onVolver).toHaveBeenCalled();
    expect(onElegir).not.toHaveBeenCalled();
  });
});

describe("SheetMetodoPago", () => {
  it("con un cobro en vuelo, Escape no lo cierra; al entrar, se cierra solo", async () => {
    let resolver: () => void = () => {};
    const onElegir = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    const onClose = vi.fn();
    render(<SheetMetodoPago open onClose={onClose} onElegir={onElegir} />);
    const sheet = await screen.findByRole("dialog", { name: METODO_DE_PAGO });

    fireEvent.click(within(sheet).getByRole("button", { name: "Efectivo" }));
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => resolver());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

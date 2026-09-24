// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BarraAcciones } from "../barra-acciones";
afterEach(cleanup);
it("volver a escribirla pide confirmación y conserva la acción existente", () => {
  const pedir = vi.fn();
  render(<BarraAcciones puedeAprobar enviando={false} onAprobar={vi.fn()} onDescartar={pedir} />);
  expect(screen.queryByRole("button", {name:"Descartar"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"Volver a escribirla"}));
  expect(pedir).not.toHaveBeenCalled();
  expect(screen.getByText(/No se vuelve a transcribir/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Volver a escribirla"}));
  expect(pedir).toHaveBeenCalledOnce();
});
it("aprobar informa el borrado en segundo plano y mantiene la confirmación", () => {
  const aprobar = vi.fn();
  render(<BarraAcciones puedeAprobar enviando={false} onAprobar={aprobar} onDescartar={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:/Aprobar nota/}));
  expect(screen.getByText(/se borra ahora, en segundo plano y con reintentos/)).toBeTruthy();
  expect(aprobar).not.toHaveBeenCalled();
});

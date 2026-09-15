// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvisoVersion } from "../aviso-version";

const estado = vi.hoisted(() => ({ ruta: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => estado.ruta }));
vi.mock("@/lib/version-app", () => ({ VERSION_APP: "version-inicial" }));
const pedir = vi.fn();
const respuesta = (version = "version-nueva") => new Response(JSON.stringify({ data: { version } }));
beforeEach(() => {
  estado.ruta = "/";
  pedir.mockReset();
  vi.stubGlobal("fetch", pedir);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.history.replaceState({}, "", "/");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("mantiene la pantalla actual y sólo recarga al tocar", async () => {
  pedir.mockResolvedValue(respuesta());
  const recargar = vi.fn();
  render(<AvisoVersion recargar={recargar} />);
  const boton = await screen.findByRole("button", { name: "Hay una versión nueva. Tocá para actualizar" });
  expect(recargar).not.toHaveBeenCalled();
  expect(pedir).toHaveBeenCalledWith("/api/version", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  fireEvent.click(boton);
  expect(recargar).toHaveBeenCalledTimes(1);
});
it("no avisa si la versión sigue igual y vuelve a comprobar al tomar foco", async () => {
  pedir.mockResolvedValueOnce(respuesta("version-inicial")).mockResolvedValueOnce(respuesta());
  render(<AvisoVersion />);
  await waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.focus(window);
  await screen.findByRole("button");
});
it.each(["/grabar", "/grabar/una-sesion"])("espera al salir de %s, incluso si ya detectó la versión", async ruta => {
  pedir.mockImplementation(async () => respuesta());
  const recargar = vi.fn();
  const vista = render(<AvisoVersion recargar={recargar} />);
  await screen.findByRole("button");
  estado.ruta = ruta;
  vista.rerender(<AvisoVersion recargar={recargar} />);
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.focus(window);
  fireEvent(document, new Event("visibilitychange"));
  expect(pedir).toHaveBeenCalledTimes(1);
  expect(recargar).not.toHaveBeenCalled();
  estado.ruta = "/agenda";
  vista.rerender(<AvisoVersion recargar={recargar} />);
  await screen.findByRole("button");
  await waitFor(() => expect(pedir).toHaveBeenCalledTimes(2));
});
it("no consulta si abre grabando; reanuda al salir", async () => {
  estado.ruta = "/grabar";
  pedir.mockResolvedValue(respuesta());
  const vista = render(<AvisoVersion />);
  expect(pedir).not.toHaveBeenCalled();
  estado.ruta = "/";
  vista.rerender(<AvisoVersion />);
  await screen.findByRole("button");
});
it("rechaza un toque que coincide con la navegación real a grabar", async () => {
  pedir.mockResolvedValue(respuesta());
  const recargar = vi.fn();
  render(<AvisoVersion recargar={recargar} />);
  const boton = await screen.findByRole("button");
  window.history.replaceState({}, "", "/grabar/sesion");
  fireEvent.click(boton);
  expect(recargar).not.toHaveBeenCalled();
});
it("no consulta oculta y reintenta al volver visible o desde la caché de navegación", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  pedir.mockRejectedValueOnce(new Error("sin red")).mockResolvedValueOnce(respuesta());
  render(<AvisoVersion />);
  expect(pedir).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent(window, new Event("pageshow"));
  await screen.findByRole("button");
});
it.each([new Response("falló", { status: 503 }), new Response("no json"), respuesta("")])("ignora una respuesta inválida sin interrumpir la app", async res => {
  pedir.mockResolvedValue(res);
  await act(async () => { render(<AvisoVersion />); });
  expect(screen.queryByRole("button")).toBeNull();
});
it("cancela un pedido colgado y evita duplicados mientras está en curso", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  pedir.mockImplementation((_url, opciones) => {
    signal = opciones.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("abortado"))));
  });
  render(<AvisoVersion />);
  fireEvent.focus(window);
  expect(pedir).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
});
it("ignora una respuesta que llegó después de entrar a grabar", async () => {
  let resolver!: (res: Response) => void;
  pedir.mockReturnValue(new Promise<Response>(r => { resolver = r; }));
  const vista = render(<AvisoVersion />);
  estado.ruta = "/grabar";
  vista.rerender(<AvisoVersion />);
  await act(async () => { resolver(respuesta()); });
  expect(screen.queryByRole("button")).toBeNull();
});

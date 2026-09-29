// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";

import { useEnvio } from "../useEnvio";

it("un envío que sale bien devuelve true y no deja error", async () => {
  const fn = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useEnvio(fn, "Algo falló"));
  let ok = false;
  await act(async () => { ok = await result.current.enviar(); });
  expect(ok).toBe(true);
  expect(result.current.error).toBe("");
  expect(result.current.enviando).toBe(false);
});

it("un error de la API se dice con su texto; cualquier otro, con el de por defecto", async () => {
  const fn = vi.fn()
    .mockRejectedValueOnce(new ApiClientError("La contraseña actual no es correcta", 400))
    .mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const { result } = renderHook(() => useEnvio(fn, "Algo falló"));
  await act(async () => { await result.current.enviar(); });
  expect(result.current.error).toBe("La contraseña actual no es correcta");
  await act(async () => { await result.current.enviar(); });
  expect(result.current.error).toBe("Algo falló");
});

it("con `describir` el error es siempre el mismo", async () => {
  const fn = vi.fn().mockRejectedValue(new ApiClientError("No existe ese email", 404));
  const { result } = renderHook(() => useEnvio(fn, "Algo falló", () => "Neutral"));
  await act(async () => { await result.current.enviar(); });
  expect(result.current.error).toBe("Neutral");
});

it("un segundo envío mientras el primero está en vuelo no sale", async () => {
  let terminar: () => void = () => {};
  const fn = vi.fn(() => new Promise<void>((r) => { terminar = r; }));
  const { result } = renderHook(() => useEnvio(fn, "Algo falló"));
  let primero: Promise<boolean> = Promise.resolve(false);
  let segundo = true;
  await act(async () => {
    primero = result.current.enviar();
    segundo = await result.current.enviar();
  });
  expect(segundo).toBe(false);
  expect(fn).toHaveBeenCalledTimes(1);
  await act(async () => { terminar(); await primero; });
});

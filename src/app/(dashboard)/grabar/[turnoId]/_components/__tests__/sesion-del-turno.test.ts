// La sesión de una grabación, al subirla, sin React: lo que
// flujo-grabacion.ts hacía adentro del hook. Los recorridos de pantalla
// (grabar-subida, grabar-sin-conexion) siguen siendo el juez del flujo.

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { SESION_EN_CAMINO } from "@/lib/glosario";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), volver: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPost: m.post,
}));
vi.mock("@/lib/subida-audio", async (original) => ({
  ...(await original<typeof import("@/lib/subida-audio")>()),
  volverAGrabando: m.volver,
}));

import { asegurarSesion } from "../sesion-del-turno";

const INICIO = new Date("2026-10-09T12:30:00.000Z");

afterEach(() => vi.clearAllMocks());

describe("asegurarSesion", () => {
  it("sin sesión la crea en grabando, con la hora en que empezó la grabación", async () => {
    m.get.mockResolvedValueOnce(null);
    m.post.mockResolvedValueOnce({ id: "s1", estado: "grabando" });
    await expect(asegurarSesion("t1", INICIO)).resolves.toBe("s1");
    expect(m.post).toHaveBeenCalledWith("/api/sesion-clinica", { turnoId: "t1", iniciadaEn: INICIO.toISOString() });
  });

  it("sin hora de inicio no la manda", async () => {
    m.get.mockResolvedValueOnce(null);
    m.post.mockResolvedValueOnce({ id: "s1", estado: "grabando" });
    await asegurarSesion("t1", null);
    expect(m.post).toHaveBeenCalledWith("/api/sesion-clinica", { turnoId: "t1" });
  });

  it("una que quedó subiendo vuelve a grabando", async () => {
    m.get.mockResolvedValueOnce({ id: "s1", estado: "subiendo" });
    await expect(asegurarSesion("t1", INICIO)).resolves.toBe("s1");
    expect(m.volver).toHaveBeenCalledWith("s1");
    expect(m.post).not.toHaveBeenCalled();
  });

  it("una ya en camino no admite otro audio: 409 con el texto para ella", async () => {
    m.get.mockResolvedValueOnce({ id: "s1", estado: "procesando" });
    const error = await asegurarSesion("t1", INICIO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 409, mensaje: SESION_EN_CAMINO });
  });
});

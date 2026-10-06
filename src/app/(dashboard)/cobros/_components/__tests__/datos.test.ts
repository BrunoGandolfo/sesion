// Lo puro de Cobros: qué se dice cuando el cobro de varias sesiones termina
// o se corta, el cobro en orden, y qué sesiones se ofrecen para pagar.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { COBRO_INCOMPLETO, NO_SE_PUDO_COBRAR } from "@/lib/glosario";

import {
  cobrarSesiones,
  desenlaceDelCobro,
  errorDelCobro,
  leerSesionesImpagas,
  recordarCobro,
} from "../datos";

const m = vi.hoisted(() => ({ cobrar: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/cobrar-cliente", () => ({ cobrarTurno: m.cobrar }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPost: m.post,
}));

beforeEach(() => {
  m.cobrar.mockReset();
  m.get.mockReset();
  m.post.mockReset();
});

describe("desenlaceDelCobro", () => {
  it("sin resultado (se fue sin elegir) no pasa nada", () => {
    expect(desenlaceDelCobro(null)).toEqual({ tipo: "nada" });
  });

  it("con todas cobradas, cobrado", () => {
    expect(desenlaceDelCobro({ registradas: 3, elegidas: 3 })).toEqual({ tipo: "cobrado" });
  });

  it("con algunas cobradas, dice cuántas entraron", () => {
    expect(desenlaceDelCobro({ registradas: 1, elegidas: 3 })).toEqual({
      tipo: "incompleto",
      mensaje: COBRO_INCOMPLETO(1, 3),
    });
  });

  it("si no entró ninguna, el panel sigue como estaba", () => {
    expect(desenlaceDelCobro({ registradas: 0, elegidas: 2 })).toEqual({ tipo: "nada" });
  });
});

describe("errorDelCobro", () => {
  it("si ya entraron algunas, dice cuántas", () => {
    expect(errorDelCobro({ registradas: 2, elegidas: 3 }, new Error("x"))).toBe(COBRO_INCOMPLETO(2, 3));
  });

  it("si no entró ninguna, el texto de la API o uno para ella", () => {
    expect(errorDelCobro({ registradas: 0, elegidas: 1 }, new ApiClientError("El turno cambió", 409))).toBe("El turno cambió");
    expect(errorDelCobro(null, new TypeError("Failed to fetch"))).toBe(NO_SE_PUDO_COBRAR);
  });
});

describe("cobrarSesiones", () => {
  it("cobra en orden y avisa cada una que entra; se corta en la que falla", async () => {
    m.cobrar.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("falló"));
    const entraron: string[] = [];
    await expect(cobrarSesiones(["a", "b", "c"], "efectivo", (id) => entraron.push(id))).rejects.toThrow("falló");
    expect(m.cobrar.mock.calls).toEqual([["a", "efectivo"], ["b", "efectivo"]]);
    expect(entraron).toEqual(["a"]);
  });
});

describe("leerSesionesImpagas", () => {
  it("deja solo las que son deuda, de la más vieja a la más nueva", async () => {
    const turno = (id: string, fecha: string, extra: Record<string, unknown>) => ({
      id, fecha, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 1000, ...extra,
    });
    m.get.mockResolvedValue({
      turnos: [
        turno("nueva", "2026-09-20T13:00:00.000Z", {}),
        turno("pagada", "2026-09-10T13:00:00.000Z", { pagoEstado: "pagado" }),
        turno("vieja", "2026-09-01T13:00:00.000Z", {}),
      ],
    });
    const impagas = await leerSesionesImpagas("p1", new AbortController().signal);
    expect(m.get).toHaveBeenCalledWith("/api/pacientes/p1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(impagas.map((t) => t.id)).toEqual(["vieja", "nueva"]);
  });
});

describe("recordarCobro", () => {
  it("devuelve si se programó un aviso nuevo", async () => {
    m.post.mockResolvedValue({ envioId: "e1", creado: false, programadoEn: "2026-10-06T12:00:00.000Z" });
    await expect(recordarCobro("p1")).resolves.toBe(false);
    expect(m.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", {});
  });
});

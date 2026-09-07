/**
 * `marcarTurnoRealizado` — el paso que cierra la grabación.
 *
 * POR QUÉ ESTE TEST
 *
 * Cuando el audio ya está en R2, la pantalla de grabar marca el turno como
 * realizado. Ese PATCH tenía un `catch {}` vacío: si fallaba, el turno se
 * quedaba en "Agendado" para siempre y nadie se enteraba, porque la nota
 * llegaba igual y no había ningún síntoma. Lo que se prueba acá es que el
 * fallo se puede ver desde afuera —la función lanza, con el mensaje que dio
 * la API— para que la pantalla lo diga y ofrezca reintentar.
 *
 * Es una función de módulo, no un hook: se prueba con un doble de `fetch` en
 * el global. El proyecto no tiene jsdom ni @testing-library, así que la
 * pantalla en sí (el toast, el botón "Reintentar") no se puede renderizar en
 * un test; lo que sí queda fijado es el contrato del que depende.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marcarTurnoRealizado } from "@/hooks/useGrabacionSesion";

const TURNO_ID = "turno_1";

type Llamada = { url: string; init?: RequestInit };

let llamadas: Llamada[] = [];
const fetchOriginal = globalThis.fetch;

function respuesta(ok: boolean, status: number, cuerpo: unknown): Response {
  return {
    ok,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

function fetchQueDevuelve(ok: boolean, status: number, cuerpo: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return respuesta(ok, status, cuerpo);
  });
}

beforeEach(() => {
  llamadas = [];
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

describe("marcarTurnoRealizado", () => {
  it("hace PATCH del turno con estado realizado", async () => {
    globalThis.fetch = fetchQueDevuelve(true, 200, {
      data: { id: TURNO_ID, estado: "realizado" },
    }) as unknown as typeof fetch;

    await marcarTurnoRealizado(TURNO_ID);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(`/api/turnos/${TURNO_ID}`);
    expect(llamadas[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(llamadas[0].init?.body))).toEqual({
      estado: "realizado",
    });
  });

  it("lanza con el mensaje de la API cuando responde error", async () => {
    globalThis.fetch = fetchQueDevuelve(false, 409, {
      error: "El turno ya está cancelado",
    }) as unknown as typeof fetch;

    await expect(marcarTurnoRealizado(TURNO_ID)).rejects.toThrow(
      "El turno ya está cancelado",
    );
  });

  it("lanza con el status cuando el error no trae mensaje", async () => {
    globalThis.fetch = fetchQueDevuelve(false, 500, null) as unknown as typeof fetch;

    await expect(marcarTurnoRealizado(TURNO_ID)).rejects.toThrow("HTTP 500");
  });

  it("propaga el error de red: la pantalla tiene que poder mostrarlo", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await expect(marcarTurnoRealizado(TURNO_ID)).rejects.toThrow("Failed to fetch");
  });

  it("el reintento vuelve a llamar y, si sale bien, no lanza", async () => {
    let intento = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url, init });
      intento += 1;
      return intento === 1
        ? respuesta(false, 500, null)
        : respuesta(true, 200, { data: { id: TURNO_ID, estado: "realizado" } });
    }) as unknown as typeof fetch;

    await expect(marcarTurnoRealizado(TURNO_ID)).rejects.toThrow();
    await expect(marcarTurnoRealizado(TURNO_ID)).resolves.toBeUndefined();
    expect(llamadas).toHaveLength(2);
  });
});

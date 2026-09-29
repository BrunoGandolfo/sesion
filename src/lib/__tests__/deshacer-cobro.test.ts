/**
 * `deshacerCobro` (src/lib/cobrar-cliente.ts) — la reversión del cobro, del
 * lado del navegador. Es la única función que llama a DELETE
 * /api/turnos/[id]/cobrar; la usan la ficha y el detalle del turno en la
 * agenda. Se prueba el pedido y el parseo de la respuesta, que es de dónde
 * sale el ajuste optimista de la fila.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deshacerCobro } from "@/lib/cobrar-cliente";

const TURNO_ID = "turno_1";

const TURNO_SIN_COBRO = {
  id: TURNO_ID,
  pacienteId: "pac_1",
  organizationId: "org_1",
  fecha: "2026-09-05T18:15:00.000Z",
  duracion: 50,
  modalidad: "presencial",
  estado: "realizado",
  tarifaCobrada: 1800,
  pagoEstado: "pendiente",
  pagoFecha: null,
  pagoMetodo: null,
  notas: null,
  creadoEn: "2026-09-01T12:00:00.000Z",
  actualizadoEn: "2026-09-05T19:00:00.000Z",
};

type Llamada = { url: string; init?: RequestInit };

let llamadas: Llamada[] = [];
const fetchOriginal = globalThis.fetch;

function respuesta(ok: boolean, status: number, cuerpo: unknown): Response {
  return { ok, status, json: async () => cuerpo } as unknown as Response;
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

describe("deshacerCobro", () => {
  it("hace DELETE a la ruta de cobro del turno", async () => {
    globalThis.fetch = fetchQueDevuelve(true, 200, {
      data: TURNO_SIN_COBRO,
    }) as unknown as typeof fetch;

    await deshacerCobro(TURNO_ID, new Date(TURNO_SIN_COBRO.actualizadoEn));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(`/api/turnos/${TURNO_ID}/cobrar`);
    expect(llamadas[0].init?.method).toBe("DELETE");
    expect(JSON.parse(llamadas[0].init!.body as string)).toEqual({ actualizadoEn: TURNO_SIN_COBRO.actualizadoEn });
  });

  it("devuelve el turno ya sin cobro, con las fechas como Date", async () => {
    globalThis.fetch = fetchQueDevuelve(true, 200, {
      data: TURNO_SIN_COBRO,
    }) as unknown as typeof fetch;

    const turno = await deshacerCobro(TURNO_ID, new Date(TURNO_SIN_COBRO.actualizadoEn));

    expect(turno.pagoEstado).toBe("pendiente");
    expect(turno.pagoMetodo).toBeNull();
    expect(turno.pagoFecha).toBeNull();
    // El turno sigue realizado: deshacer el cobro no lo desagenda.
    expect(turno.estado).toBe("realizado");
    expect(turno.fecha).toBeInstanceOf(Date);
    expect(turno.fecha.toISOString()).toBe("2026-09-05T18:15:00.000Z");
  });

  it("lanza con el mensaje de la API si el turno no estaba cobrado", async () => {
    globalThis.fetch = fetchQueDevuelve(false, 400, {
      error: "El turno no está cobrado",
    }) as unknown as typeof fetch;

    await expect(deshacerCobro(TURNO_ID, new Date(TURNO_SIN_COBRO.actualizadoEn))).rejects.toThrow(
      "El turno no está cobrado",
    );
  });

  it("lanza si el turno no existe", async () => {
    globalThis.fetch = fetchQueDevuelve(false, 404, {
      error: "Turno no encontrado",
    }) as unknown as typeof fetch;

    await expect(deshacerCobro(TURNO_ID, new Date(TURNO_SIN_COBRO.actualizadoEn))).rejects.toThrow(
      "Turno no encontrado",
    );
  });
});

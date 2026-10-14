// reconciliarEnvios cuando la consulta a Twilio falla: la fila trae el
// código de Twilio, el estado HTTP y el mensaje en una línea, para que
// scripts/mantenimiento/reconciliar-sms.mjs lo imprima sin un fetch propio.
// Con consultarMensajeTwilio real y fetch doblado; la base, doblada.

import { describe, expect, it, vi } from "vitest";

import { reconciliarEnvios } from "@/app/api/_lib/casos-uso/sms-webhooks";
import { consultarMensajeTwilio } from "@/lib/sms/twilio";

import { motivoDeError } from "../../../scripts/mantenimiento/reconciliar-sms.mjs";

const ENV = { TWILIO_ACCOUNT_SID: "AC-cuenta-de-prueba", TWILIO_AUTH_TOKEN: "token-de-prueba" };
const AHORA = new Date("2026-10-13T12:00:00.000Z");

function prismaCon(sids: string[]) {
  return {
    envioSms: {
      findMany: vi.fn(async () => sids.map((sid) => ({ sid }))),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as Parameters<typeof reconciliarEnvios>[0]["prisma"];
}

const reconciliarCon = (fetcher: typeof fetch, simular = false) => {
  const prisma = prismaCon(["SM1"]);
  return {
    prisma,
    filas: reconciliarEnvios({ prisma, consultar: (sid) => consultarMensajeTwilio(sid, { env: ENV, fetcher }), simular, ahora: AHORA }),
  };
};

describe("reconciliarEnvios: el motivo de un error de Twilio llega a la fila", () => {
  it("un 401 trae el código de Twilio, el HTTP y el mensaje, no el cuerpo entero", async () => {
    const cuerpo = { code: 20003, message: "Authenticate", more_info: "https://www.twilio.com/docs/errors/20003", status: 401 };
    const fetcher = (async () => new Response(JSON.stringify(cuerpo), { status: 401 })) as typeof fetch;
    const { prisma, filas } = reconciliarCon(fetcher);

    const [fila] = await filas;
    expect(fila).toEqual({
      sid: "SM1", status: null, codigo: null, efecto: "error", actualizados: 0,
      error: { codigo: 20003, httpStatus: 401, mensaje: "Authenticate" },
    });
    expect(JSON.stringify(fila)).not.toContain("more_info");
    expect(prisma.envioSms.updateMany).not.toHaveBeenCalled();
    expect(motivoDeError(fila.error)).toBe("Twilio 20003 (HTTP 401): Authenticate");
  });

  it("un error de red trae la causa y httpStatus null", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    }) as typeof fetch;
    const { prisma, filas } = reconciliarCon(fetcher, true);

    const [fila] = await filas;
    expect(fila).toMatchObject({ sid: "SM1", efecto: "error", actualizados: 0 });
    expect(fila.error).toEqual({ codigo: null, httpStatus: null, mensaje: "red: fetch failed (ECONNREFUSED)" });
    expect(prisma.envioSms.updateMany).not.toHaveBeenCalled();
    expect(motivoDeError(fila.error)).toBe("red: fetch failed (ECONNREFUSED)");
  });

  it("un envío consultado bien no trae error", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ status: "delivered", error_code: null }), { status: 200 })) as typeof fetch;
    const [fila] = await reconciliarCon(fetcher, true).filas;
    expect(fila).toMatchObject({ efecto: "entregado", error: null });
  });
});

// consultarMensajeTwilio: lo que usa la reconciliación de SMS para saber cómo
// terminó un mensaje cuyo StatusCallback se perdió. Con fetch doblado.

import { describe, expect, it } from "vitest";

import { consultarMensajeTwilio } from "@/lib/sms/twilio";

const ENV = { TWILIO_ACCOUNT_SID: "AC-cuenta-de-prueba", TWILIO_AUTH_TOKEN: "token-de-prueba" };

function fetcherQue(status: number, cuerpo: unknown, pedidos: Request[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push(new Request(url, init));
    return new Response(JSON.stringify(cuerpo), { status });
  }) as typeof fetch;
}

describe("consultarMensajeTwilio", () => {
  it("GET al mensaje de la cuenta, con basic auth, y devuelve status y código", async () => {
    const pedidos: Request[] = [];
    const r = await consultarMensajeTwilio("SM1", { env: ENV, fetcher: fetcherQue(200, { status: "undelivered", error_code: 30003 }, pedidos) });
    expect(r).toEqual({ tipo: "ok", status: "undelivered", codigo: 30003 });
    expect(pedidos[0].method).toBe("GET");
    expect(pedidos[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Messages/SM1.json`);
    expect(pedidos[0].headers.get("authorization")).toMatch(/^Basic /);
  });

  it("sin código de error devuelve null", async () => {
    expect(await consultarMensajeTwilio("SM1", { env: ENV, fetcher: fetcherQue(200, { status: "delivered", error_code: null }) }))
      .toEqual({ tipo: "ok", status: "delivered", codigo: null });
  });

  it("un 404 o sin credenciales es error, no un estado", async () => {
    expect(await consultarMensajeTwilio("SM1", { env: ENV, fetcher: fetcherQue(404, { message: "not found" }) }))
      .toEqual({ tipo: "error", mensaje: "not found" });
    expect(await consultarMensajeTwilio("SM1", { env: {} })).toEqual({ tipo: "error", mensaje: "faltan credenciales de Twilio" });
  });
});

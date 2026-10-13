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
    expect(await consultarMensajeTwilio("SM1", { env: ENV, fetcher: fetcherQue(404, { code: 20404, message: "not found" }) }))
      .toEqual({ tipo: "error", codigo: 20404, httpStatus: 404, mensaje: "not found" });
    expect(await consultarMensajeTwilio("SM1", { env: {} }))
      .toEqual({ tipo: "error", codigo: null, httpStatus: null, mensaje: "faltan credenciales de Twilio" });
  });

  it("el mensaje de error es una línea con tope, y sin cuerpo legible dice el HTTP", async () => {
    const largo = `uno\n  dos ${"x".repeat(500)}`;
    const r = await consultarMensajeTwilio("SM1", { env: ENV, fetcher: fetcherQue(500, { message: largo }) });
    expect(r.tipo === "error" && r.mensaje).toMatch(/^uno dos x+…$/);
    expect(r.tipo === "error" && r.mensaje.length).toBe(200);
    const sinCuerpo = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    expect(await consultarMensajeTwilio("SM1", { env: ENV, fetcher: sinCuerpo }))
      .toEqual({ tipo: "error", codigo: null, httpStatus: 502, mensaje: "HTTP 502" });
  });
});

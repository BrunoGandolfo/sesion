// Unitario — el cliente de Twilio con un fetch de mentira. Lo que se fija
// es la traducción de cada cosa que puede pasar en la red a una de las
// cuatro respuestas, y sobre todo cuál de ellas es `desconocido`: la que
// nunca se reenvía.

import { describe, expect, it, vi } from "vitest";

import { enviarSmsTwilio, smsConfigurado, TIMEOUT_TWILIO_MS } from "@/lib/sms/twilio";

const ENV = { TWILIO_ACCOUNT_SID: "ACfalso", TWILIO_AUTH_TOKEN: "token", TWILIO_SMS_FROM: "+59890000000" };
const PEDIDO = { destino: "+59899123456", texto: "Hola", statusCallback: "https://sesionapp.app/api/sms/callback" };

function fetchQueContesta(status: number, cuerpo: string | null) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return new Response(cuerpo, { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, llamadas };
}

describe("smsConfigurado", () => {
  it("falta el From → falta_from; faltan credenciales → faltan_credenciales", () => {
    expect(smsConfigurado({})).toEqual({ ok: false, motivo: "falta_from" });
    expect(smsConfigurado({ TWILIO_SMS_FROM: "+1" })).toEqual({ ok: false, motivo: "faltan_credenciales" });
    expect(smsConfigurado(ENV)).toEqual({ ok: true });
  });
});

describe("enviarSmsTwilio", () => {
  it("201 con sid: aceptado, con los segmentos que cobró Twilio", async () => {
    const { fetcher, llamadas } = fetchQueContesta(201, JSON.stringify({ sid: "SM1", status: "queued", num_segments: "2" }));
    const r = await enviarSmsTwilio(PEDIDO, { fetcher, env: ENV });

    expect(r).toEqual({ tipo: "aceptado", sid: "SM1", segmentos: 2, estadoTwilio: "queued" });
    expect(llamadas[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACfalso/Messages.json");
    const body = new URLSearchParams(String(llamadas[0].init.body));
    expect(body.get("From")).toBe("+59890000000");
    expect(body.get("To")).toBe("+59899123456");
    expect(body.get("Body")).toBe("Hola");
    // El StatusCallback viaja: sin él nunca hay `entregado`.
    expect(body.get("StatusCallback")).toBe(PEDIDO.statusCallback);
    expect(new Headers(llamadas[0].init.headers).get("Authorization")).toBe(`Basic ${btoa("ACfalso:token")}`);
  });

  it("400 con 21211: definitivo, con la clasificación de la tabla", async () => {
    const { fetcher } = fetchQueContesta(400, JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number", status: 400 }));
    const r = await enviarSmsTwilio(PEDIDO, { fetcher, env: ENV });
    expect(r).toMatchObject({ tipo: "definitivo", codigo: 21211, httpStatus: 400, clasificacion: { clase: "definitivo" } });
  });

  it("429: transitorio con más jitter; 503: transitorio", async () => {
    const r429 = await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(429, JSON.stringify({ code: 20429 })).fetcher, env: ENV });
    expect(r429).toMatchObject({ tipo: "transitorio", codigo: 20429, clasificacion: { jitterMayor: true } });
    const r503 = await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(503, "<html>").fetcher, env: ENV });
    expect(r503).toMatchObject({ tipo: "transitorio", codigo: null, httpStatus: 503 });
  });

  it("30002 cuenta suspendida: transitorio y crítico", async () => {
    const r = await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(400, JSON.stringify({ code: 30002 })).fetcher, env: ENV });
    expect(r).toMatchObject({ tipo: "transitorio", clasificacion: { alerta: "critico" } });
  });

  it("timeout esperando la respuesta: DESCONOCIDO, nunca transitorio", async () => {
    // El cuerpo ya viajó; Twilio pudo haberlo aceptado. Reintentar duplica.
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      }),
    ) as unknown as typeof fetch;

    const r = await enviarSmsTwilio(PEDIDO, { fetcher, env: ENV, timeoutMs: 20 });
    expect(r.tipo).toBe("desconocido");
    if (r.tipo === "desconocido") expect(r.motivo).toContain("no respondió");
    expect(TIMEOUT_TWILIO_MS).toBe(10_000);
  });

  it("conexión cortada a mitad (ECONNRESET): desconocido", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    }) as unknown as typeof fetch;
    expect((await enviarSmsTwilio(PEDIDO, { fetcher, env: ENV })).tipo).toBe("desconocido");
  });

  it("DNS que no resuelve o conexión rechazada: transitorio (el cuerpo no viajó)", async () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]) {
      const fetcher = vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: { code } });
      }) as unknown as typeof fetch;
      const r = await enviarSmsTwilio(PEDIDO, { fetcher, env: ENV });
      expect(r).toMatchObject({ tipo: "transitorio", codigo: null, httpStatus: null });
    }
  });

  it("2xx sin cuerpo legible o sin sid: desconocido", async () => {
    expect((await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(201, "no es json").fetcher, env: ENV })).tipo).toBe("desconocido");
    expect((await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(201, "{}").fetcher, env: ENV })).tipo).toBe("desconocido");
  });

  it("sin configuración: transitorio y crítico, sin tocar la red", async () => {
    const { fetcher, llamadas } = fetchQueContesta(201, "{}");
    const r = await enviarSmsTwilio(PEDIDO, { fetcher, env: {} });
    expect(r).toMatchObject({ tipo: "transitorio", clasificacion: { alerta: "critico" } });
    expect(llamadas).toHaveLength(0);
  });

  it("num_segments ilegible: aceptado con segmentos null (el despachador estima)", async () => {
    const r = await enviarSmsTwilio(PEDIDO, { fetcher: fetchQueContesta(201, JSON.stringify({ sid: "SM2" })).fetcher, env: ENV });
    expect(r).toMatchObject({ tipo: "aceptado", sid: "SM2", segmentos: null });
  });
});

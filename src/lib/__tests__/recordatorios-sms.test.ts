import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  estaVencido,
  sendSms,
  smsConfigurado,
} from "@/lib/recordatorios-sms";

// El texto del SMS (template, variables, conteo de longitud) se prueba en
// sms-texto.test.ts. Acá solo el cliente Twilio y las reglas del cron.

describe("smsConfigurado / sendSms sin configuración", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("devuelve falta_from si no hay TWILIO_SMS_FROM", () => {
    vi.stubEnv("TWILIO_SMS_FROM", "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    expect(smsConfigurado()).toEqual({ ok: false, motivo: "falta_from" });
  });

  it("devuelve faltan_credenciales si hay From pero no SID/token", () => {
    vi.stubEnv("TWILIO_SMS_FROM", "+59899000000");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect(smsConfigurado()).toEqual({
      ok: false,
      motivo: "faltan_credenciales",
    });
  });

  it("devuelve ok con las tres envs", () => {
    vi.stubEnv("TWILIO_SMS_FROM", "+59899000000");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    expect(smsConfigurado()).toEqual({ ok: true });
  });

  it("sendSms sin From devuelve success:false y no llama a fetch", async () => {
    vi.stubEnv("TWILIO_SMS_FROM", "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");

    const out = await sendSms({ to: "+59899123456", text: "hola" });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/TWILIO_SMS_FROM/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendSms con teléfono inválido no llama a fetch", async () => {
    vi.stubEnv("TWILIO_SMS_FROM", "+59899000000");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");

    const out = await sendSms({ to: "no-es-un-telefono", text: "hola" });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Teléfono inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendSms manda From/To en E.164 sin prefijo whatsapp: y devuelve el sid", async () => {
    vi.stubEnv("TWILIO_SMS_FROM", "+59899000000");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ sid: "SM123", status: "queued" }),
    });

    const out = await sendSms({ to: "099 123 456", text: "hola" });

    expect(out).toEqual({ success: true, sid: "SM123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json",
    );
    expect(init.method).toBe("POST");
    const params = new URLSearchParams(String(init.body));
    expect(params.get("From")).toBe("+59899000000");
    expect(params.get("To")).toBe("+59899123456");
    expect(params.get("Body")).toBe("hola");
    expect(params.get("To")).not.toMatch(/^whatsapp:/);
  });

  it("sendSms parsea el error JSON de Twilio", async () => {
    vi.stubEnv("TWILIO_SMS_FROM", "+59899000000");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      status: 400,
      json: async () => ({ code: 21211, message: "Invalid 'To'", status: 400 }),
    });

    const out = await sendSms({ to: "+59899123456", text: "hola" });

    expect(out.success).toBe(false);
    expect(out.error).toBe("Twilio 21211: Invalid 'To'");
  });
});

describe("estaVencido", () => {
  const ahora = new Date(2026, 3, 20, 12, 0);

  it("fecha pasada → true", () => {
    expect(
      estaVencido({ fecha: new Date(2026, 3, 20, 11, 59), estado: "programado" }, ahora),
    ).toBe(true);
  });

  it("turno cancelado → true aunque sea futuro", () => {
    expect(
      estaVencido({ fecha: new Date(2026, 3, 25, 10, 0), estado: "cancelado" }, ahora),
    ).toBe(true);
  });

  it("turno ausente → true", () => {
    expect(
      estaVencido({ fecha: new Date(2026, 3, 25, 10, 0), estado: "ausente" }, ahora),
    ).toBe(true);
  });

  it("futuro programado → false", () => {
    expect(
      estaVencido({ fecha: new Date(2026, 3, 25, 10, 0), estado: "programado" }, ahora),
    ).toBe(false);
  });

  it("mismo instante no está vencido", () => {
    expect(estaVencido({ fecha: new Date(ahora), estado: "programado" }, ahora)).toBe(
      false,
    );
  });
});

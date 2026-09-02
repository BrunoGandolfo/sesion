import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  asegurarLineaContacto,
  buildReminderMessage,
  buildSmsMessage,
  contarLongitudSms,
  estaVencido,
  LINEA_CONTACTO,
  sendSms,
  smsConfigurado,
  TEMPLATE_SMS_SUGERIDO,
} from "@/lib/recordatorios-sms";

const baseData = {
  nombre: "Ana",
  apellido: "Pérez",
  // 20 abril 2026, 09:00 — lunes
  fecha: new Date(2026, 3, 20, 9, 0),
  direccion: "Bvar. España 2345",
  profesional: "Lic. María García",
  telefonoConsultorio: "+598 99 876 543",
};

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

describe("buildSmsMessage", () => {
  it("reemplaza {{nombre}} y {{apellido}}", () => {
    const out = buildSmsMessage("Hola {{nombre}} {{apellido}}", baseData);
    expect(out).toBe("Hola Ana Pérez");
  });

  it("formatea {{fecha}} como 'EEEE d de MMMM' en español", () => {
    const out = buildSmsMessage("Tu sesión: {{fecha}}", baseData);
    expect(out).toBe("Tu sesión: lunes 20 de abril");
  });

  it("formatea {{hora}} en 24h con dos dígitos", () => {
    const out = buildSmsMessage("A las {{hora}}", baseData);
    expect(out).toBe("A las 09:00");
  });

  it("reemplaza {{direccion}} y {{profesional}}", () => {
    const out = buildSmsMessage("{{direccion}} — {{profesional}}", baseData);
    expect(out).toBe("Bvar. España 2345 — Lic. María García");
  });

  it("reemplaza {{telefonoConsultorio}}", () => {
    const out = buildSmsMessage("Llamá al {{telefonoConsultorio}}", baseData);
    expect(out).toBe("Llamá al +598 99 876 543");
  });

  it("{{telefonoConsultorio}} ausente se reemplaza por vacío", () => {
    const out = buildSmsMessage("Tel: {{telefonoConsultorio}}.", {
      nombre: "Ana",
      apellido: "Pérez",
      fecha: baseData.fecha,
      direccion: "",
      profesional: "X",
    });
    expect(out).toBe("Tel: .");
  });

  it("reemplaza todas las variables de un template completo", () => {
    const out = buildSmsMessage(TEMPLATE_SMS_SUGERIDO, baseData);
    expect(out).toContain("Hola Ana");
    expect(out).toContain("lunes 20 de abril");
    expect(out).toContain("09:00");
    expect(out).toContain("Lic. María García");
    expect(out).toContain("+598 99 876 543");
    // No deben quedar placeholders sin resolver
    expect(out).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  it("reemplaza todas las ocurrencias de la misma variable, no solo la primera", () => {
    const out = buildSmsMessage("{{nombre}} y {{nombre}}", baseData);
    expect(out).toBe("Ana y Ana");
  });

  it("deja intactos los placeholders que no conoce (no rompen)", () => {
    const out = buildSmsMessage("Hola {{nombre}} {{desconocido}}", baseData);
    expect(out).toBe("Hola Ana {{desconocido}}");
  });

  it("devuelve el template tal cual si no hay placeholders", () => {
    const out = buildSmsMessage("Texto plano sin variables", baseData);
    expect(out).toBe("Texto plano sin variables");
  });

  it("buildReminderMessage sigue exportado como alias", () => {
    expect(buildReminderMessage).toBe(buildSmsMessage);
  });
});

describe("TEMPLATE_SMS_SUGERIDO y línea de contacto", () => {
  it("el template sugerido termina con la línea de contacto exacta", () => {
    expect(LINEA_CONTACTO).toBe(
      "Para cambios, comunicate con {{profesional}} al {{telefonoConsultorio}}",
    );
    expect(TEMPLATE_SMS_SUGERIDO.endsWith(LINEA_CONTACTO)).toBe(true);
  });

  it("asegurarLineaContacto agrega la línea si falta", () => {
    const out = asegurarLineaContacto("Hola {{nombre}}.  ");
    expect(out).toBe(`Hola {{nombre}}.\n${LINEA_CONTACTO}`);
  });

  it("asegurarLineaContacto no duplica si ya está", () => {
    expect(asegurarLineaContacto(TEMPLATE_SMS_SUGERIDO)).toBe(
      TEMPLATE_SMS_SUGERIDO,
    );
  });

  it("con datos realistas el sugerido mide 133 caracteres en UCS-2 (2 segmentos)", () => {
    const out = buildSmsMessage(TEMPLATE_SMS_SUGERIDO, {
      nombre: "Lucía",
      apellido: "Fernández",
      fecha: new Date(2026, 3, 21, 10, 0), // martes 21 de abril, 10:00
      direccion: "",
      profesional: "Mariana Roldán",
      telefonoConsultorio: "+598 99 876 543",
    });
    expect(out).toBe(
      "Hola Lucía, te recordamos tu sesión el martes 21 de abril a las 10:00. Para cambios, comunicate con Mariana Roldán al +598 99 876 543",
    );
    expect(contarLongitudSms(out)).toEqual({
      caracteres: 133,
      segmentos: 2,
      gsm7: false,
    });
  });
});

describe("contarLongitudSms", () => {
  it("texto vacío: 0 caracteres, 0 segmentos", () => {
    expect(contarLongitudSms("")).toEqual({
      caracteres: 0,
      segmentos: 0,
      gsm7: true,
    });
  });

  it("ASCII plano es GSM-7 y 1 segmento hasta 160", () => {
    expect(contarLongitudSms("a".repeat(160))).toEqual({
      caracteres: 160,
      segmentos: 1,
      gsm7: true,
    });
  });

  it("GSM-7 de 161 caracteres son 2 segmentos (153 por segmento)", () => {
    expect(contarLongitudSms("a".repeat(161)).segmentos).toBe(2);
    expect(contarLongitudSms("a".repeat(306)).segmentos).toBe(2);
    expect(contarLongitudSms("a".repeat(307)).segmentos).toBe(3);
  });

  it("é, ñ, ü, à están en GSM-7 básico", () => {
    expect(contarLongitudSms("señor café über à").gsm7).toBe(true);
  });

  it("los caracteres de extensión (€, [, ], {, }) cuentan doble", () => {
    const out = contarLongitudSms("a€");
    expect(out.gsm7).toBe(true);
    expect(out.caracteres).toBe(3);
  });

  it("í, ó, á, ú fuerzan UCS-2", () => {
    for (const ch of ["í", "ó", "á", "ú"]) {
      expect(contarLongitudSms(`sesi${ch}n`).gsm7).toBe(false);
    }
  });

  it("UCS-2: 70 en un segmento, 71 son dos (67 por segmento)", () => {
    expect(contarLongitudSms("í".repeat(70))).toEqual({
      caracteres: 70,
      segmentos: 1,
      gsm7: false,
    });
    expect(contarLongitudSms("í".repeat(71)).segmentos).toBe(2);
    expect(contarLongitudSms("í".repeat(134)).segmentos).toBe(2);
    expect(contarLongitudSms("í".repeat(135)).segmentos).toBe(3);
  });

  it("emoji cuenta como dos unidades UCS-2", () => {
    expect(contarLongitudSms("a😀")).toEqual({
      caracteres: 3,
      segmentos: 1,
      gsm7: false,
    });
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

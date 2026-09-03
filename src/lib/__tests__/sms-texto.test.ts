import { describe, expect, it } from "vitest";

import {
  asegurarLineaContacto,
  buildSmsMessage,
  contarLongitudSms,
  LINEA_CONTACTO,
  TEMPLATE_SMS_SUGERIDO,
} from "@/lib/sms-texto";

const baseData = {
  nombre: "Ana",
  apellido: "Pérez",
  // 20 abril 2026, 09:00 — lunes
  fecha: new Date(2026, 3, 20, 9, 0),
  direccion: "Bvar. España 2345",
  profesional: "Lic. María García",
  telefonoConsultorio: "+598 99 876 543",
};

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

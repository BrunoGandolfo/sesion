import { describe, expect, it } from "vitest";

import {
  prepararPlantillaRecordatorio,
  armarMensaje,
  TEMPLATE_RECORDATORIO_SUGERIDO,
  textoDelEnvio,
} from "@/lib/recordatorio-texto";
import { LINEA_CONTACTO, PLANTILLA_CAMBIO_DE_HORARIO } from "@/lib/glosario";

const baseData = {
  nombre: "Ana",
  apellido: "Pérez",
  // Lunes 20 de abril de 2026, 09:00 de Montevideo = 12:00Z. El instante va
  // en UTC explícito: el cron corre en Vercel, que va en UTC.
  fecha: new Date("2026-04-20T12:00:00.000Z"),
  direccion: "Bvar. España 2345",
  profesional: "Lic. María García",
  telefonoConsultorio: "+598 99 876 543",
};

describe("armarMensaje", () => {
  it("dice la hora del consultorio, no la del servidor", () => {
    const out = armarMensaje("Te esperamos a las {{hora}}", {
      ...baseData,
      fecha: new Date("2026-09-05T18:15:00.000Z"),
    });
    expect(out).toBe("Te esperamos a las 15:15");
  });

  it("una sesión de las 21:30 no se anuncia para el día siguiente", () => {
    const out = armarMensaje("{{fecha}} a las {{hora}}", {
      ...baseData,
      fecha: new Date("2026-09-05T00:30:00.000Z"),
    });
    expect(out).toBe("viernes 4 de septiembre a las 21:30");
  });

  it("reemplaza todas las variables de la plantilla completa", () => {
    const out = armarMensaje(TEMPLATE_RECORDATORIO_SUGERIDO, baseData);
    expect(out).toContain("Ana, tu turno");
    expect(out).toContain("lunes 20 de abril");
    expect(out).toContain("09:00");
    expect(out).toContain("Lic. María García");
    expect(out).toContain("+598 99 876 543");
    expect(out).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  it("reemplaza todas las ocurrencias, no solo la primera", () => {
    expect(armarMensaje("{{nombre}} y {{nombre}}", baseData)).toBe("Ana y Ana");
  });

  it("un valor con $& o $1 entra tal cual (reemplazo con función)", () => {
    // Con replaceAll(patrón, string), "$&" repite lo buscado y "$$" se
    // vuelve "$": una paciente o una dirección con "$" salían mal.
    const out = armarMensaje("Hola {{nombre}}, {{direccion}}", {
      ...baseData,
      nombre: "Ana $& $1",
      direccion: "Local $$ 5",
    });
    expect(out).toBe("Hola Ana $& $1, Local $$ 5");
  });

  it("deja intactos los placeholders que no conoce", () => {
    expect(armarMensaje("Hola {{nombre}} {{desconocido}}", baseData)).toBe("Hola Ana {{desconocido}}");
  });

  it("{{telefonoConsultorio}} ausente se reemplaza por vacío", () => {
    const out = armarMensaje("Tel: {{telefonoConsultorio}}.", { ...baseData, telefonoConsultorio: undefined });
    expect(out).toBe("Tel: .");
  });
});

describe("plantillas y línea de contacto", () => {
  it("la sugerida termina con la línea de contacto exacta", () => {
    expect(LINEA_CONTACTO).toBe("Cambios: llamar al {{telefonoConsultorio}}");
    expect(TEMPLATE_RECORDATORIO_SUGERIDO.endsWith(LINEA_CONTACTO)).toBe(true);
  });

  it("prepararPlantillaRecordatorio agrega la línea si falta y no duplica si está", () => {
    expect(prepararPlantillaRecordatorio("Hola {{nombre}}.  ")).toBe(`Consultorio {{profesional}}\nHola {{nombre}}.\n${LINEA_CONTACTO}`);
    expect(prepararPlantillaRecordatorio(TEMPLATE_RECORDATORIO_SUGERIDO)).toBe(TEMPLATE_RECORDATORIO_SUGERIDO);
    expect(prepararPlantillaRecordatorio("")).toBe(`Consultorio {{profesional}}\n${LINEA_CONTACTO}`);
  });

  it("con datos realistas la sugerida mide 115 caracteres en UCS-2 (2 segmentos)", () => {
    const out = armarMensaje(TEMPLATE_RECORDATORIO_SUGERIDO, {
      nombre: "Lucía",
      apellido: "Fernández",
      fecha: new Date("2026-04-21T13:00:00.000Z"),
      direccion: "",
      profesional: "Mariana Roldán",
      telefonoConsultorio: "+598 99 876 543",
    });
    expect(out).toBe(
      "Consultorio Mariana Roldán\nLucía, tu turno es el martes 21 de abril a las 10:00. Cambios: llamar al +598 99 876 543",
    );
  });
});

describe("textoDelEnvio", () => {
  it("el recordatorio usa la plantilla de la organización, con la línea de contacto asegurada", () => {
    const out = textoDelEnvio("recordatorio_turno", "Hola {{nombre}}, tu sesión es el {{fecha}}.", baseData);
    expect(out).toBe(`Consultorio Lic. María García\nHola Ana, tu sesión es el lunes 20 de abril.\nCambios: llamar al +598 99 876 543`);
  });

  it("el cambio de horario usa la plantilla fija y identifica al consultorio antes de anunciar el cambio", () => {
    const out = textoDelEnvio("cambio_de_horario", "Hola {{nombre}}, te recordamos tu sesión.", baseData);
    expect(out.startsWith("Consultorio Lic. María García\nAna, tu turno cambió al lunes 20 de abril a las 09:00.")).toBe(true);
    expect(out).toContain("Cambios: llamar al +598 99 876 543");
    expect(out).not.toContain("te recordamos");
    expect(PLANTILLA_CAMBIO_DE_HORARIO).toContain(LINEA_CONTACTO);
  });
});


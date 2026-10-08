/**
 * Unitario — el enlace de WhatsApp asistido (src/lib/whatsapp.ts) y la
 * puerta única del texto del recordatorio (textoDelRecordatorio): el
 * WhatsApp y el SMS dicen lo mismo porque salen de la misma función.
 */
import { describe, expect, it } from "vitest";

import { textoDelEnvio, textoDelRecordatorio } from "@/lib/sms/texto";
import { enlaceWhatsapp } from "@/lib/whatsapp";

const TEXTO = "Hola Lucía. Te recordamos tu sesión:\njueves 4 de septiembre  |  15:15\nRivera 2540 & Br. España #3";

/** Lo que WhatsApp lee del enlace: el número y el texto decodificado. */
function abrir(enlace: string) {
  const url = new URL(enlace);
  return { host: url.host, numero: url.pathname.slice(1), texto: url.searchParams.get("text") };
}

describe("enlaceWhatsapp", () => {
  it("el número va sin + y el texto llega intacto", () => {
    const enlace = enlaceWhatsapp("+59899123456", TEXTO);
    expect(enlace).not.toBeNull();
    expect(abrir(enlace!)).toEqual({ host: "wa.me", numero: "59899123456", texto: TEXTO });
  });

  it("acentos en UTF-8, saltos de línea como %0A y los reservados codificados", () => {
    const enlace = enlaceWhatsapp("+59899123456", "sesión\nñ & # ? +");
    expect(enlace).toBe("https://wa.me/59899123456?text=sesi%C3%B3n%0A%C3%B1%20%26%20%23%20%3F%20%2B");
  });

  it("deja sólo los dígitos del teléfono", () => {
    expect(abrir(enlaceWhatsapp("+598 99-123 456", "x")!).numero).toBe("59899123456");
  });

  it("sin teléfono no hay enlace", () => {
    expect(enlaceWhatsapp("", TEXTO)).toBeNull();
    expect(enlaceWhatsapp("   ", TEXTO)).toBeNull();
  });
});

describe("textoDelRecordatorio", () => {
  const config = {
    templateRecordatorio: "Hola {{nombre}}, te espero el {{fecha}} a las {{hora}} en {{direccion}}.",
    direccion: "Rivera 2540",
    nombreProfesional: "Mariana Roldán",
    whatsappOrigen: "+598 99 876 543",
  };
  const fecha = new Date("2026-09-04T18:15:00.000Z");

  it.each(["recordatorio_turno", "cambio_de_horario"] as const)("es textoDelEnvio con la configuración (%s)", (motivo) => {
    expect(textoDelRecordatorio(motivo, config, { nombre: "Lucía", apellido: "Gómez" }, fecha)).toBe(
      textoDelEnvio(motivo, config.templateRecordatorio, {
        nombre: "Lucía",
        apellido: "Gómez",
        fecha,
        direccion: config.direccion,
        profesional: config.nombreProfesional,
        telefonoConsultorio: config.whatsappOrigen,
      }),
    );
  });
});

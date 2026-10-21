// Qué hace el botón de Recordar cobro según el canal: una sola función.
import { describe, expect, it } from "vitest";

import { accionDeCobro } from "@/lib/aviso-cobro";

const TEXTO = "Consultorio Mariana\nLucía, tenés 2 sesiones pendientes de pago: $ 2.400.";

describe("accionDeCobro", () => {
  it("con SMS automático, sale por SMS como siempre", () => {
    expect(accionDeCobro("sms", "+59899123456", TEXTO)).toEqual({ canal: "sms" });
  });

  it("con Ambos también: el SMS sale solo, como el recordatorio de turno", () => {
    expect(accionDeCobro("ambos", "+59899123456", TEXTO)).toEqual({ canal: "sms" });
  });

  it("con WhatsApp desde mi teléfono, abre wa.me con el texto de la plantilla", () => {
    expect(accionDeCobro("whatsapp", "+598 99 123 456", TEXTO)).toEqual({
      canal: "whatsapp",
      enlace: `https://wa.me/59899123456?text=${encodeURIComponent(TEXTO)}`,
    });
  });

  it("con WhatsApp y sin teléfono no hay enlace", () => {
    expect(accionDeCobro("whatsapp", "  ", TEXTO)).toEqual({ canal: "whatsapp", enlace: null });
  });
});

import { describe, it, expect } from "vitest";

import { buildReminderMessage } from "@/lib/whatsapp";

const baseData = {
  nombre: "Ana",
  apellido: "Pérez",
  // 20 abril 2026, 09:00 — lunes
  fecha: new Date(2026, 3, 20, 9, 0),
  direccion: "Bvar. España 2345",
  profesional: "Lic. María García",
};

describe("buildReminderMessage", () => {
  it("reemplaza {{nombre}} y {{apellido}}", () => {
    const out = buildReminderMessage("Hola {{nombre}} {{apellido}}", baseData);
    expect(out).toBe("Hola Ana Pérez");
  });

  it("formatea {{fecha}} como 'EEEE d de MMMM' en español", () => {
    const out = buildReminderMessage("Tu sesión: {{fecha}}", baseData);
    expect(out).toBe("Tu sesión: lunes 20 de abril");
  });

  it("formatea {{hora}} en 24h con dos dígitos", () => {
    const out = buildReminderMessage("A las {{hora}}", baseData);
    expect(out).toBe("A las 09:00");
  });

  it("reemplaza {{direccion}} y {{profesional}}", () => {
    const out = buildReminderMessage(
      "{{direccion}} — {{profesional}}",
      baseData,
    );
    expect(out).toBe("Bvar. España 2345 — Lic. María García");
  });

  it("reemplaza todas las variables de un template completo", () => {
    const template =
      "Hola {{nombre}}. Te recordamos tu sesión:\n{{fecha}}  |  {{hora}}\n{{direccion}}\n— {{profesional}}";
    const out = buildReminderMessage(template, baseData);
    expect(out).toContain("Hola Ana");
    expect(out).toContain("lunes 20 de abril");
    expect(out).toContain("09:00");
    expect(out).toContain("Bvar. España 2345");
    expect(out).toContain("Lic. María García");
    // No deben quedar placeholders sin resolver
    expect(out).not.toMatch(/\{\{[a-z]+\}\}/);
  });

  it("reemplaza todas las ocurrencias de la misma variable, no solo la primera", () => {
    const out = buildReminderMessage(
      "{{nombre}} y {{nombre}}",
      baseData,
    );
    expect(out).toBe("Ana y Ana");
  });

  it("deja intactos los placeholders que no conoce (no rompen)", () => {
    const out = buildReminderMessage("Hola {{nombre}} {{desconocido}}", baseData);
    expect(out).toBe("Hola Ana {{desconocido}}");
  });

  it("devuelve el template tal cual si no hay placeholders", () => {
    const out = buildReminderMessage("Texto plano sin variables", baseData);
    expect(out).toBe("Texto plano sin variables");
  });
});

// Unitario — el prompt de Lux: que esté entero, que no lleve nada variable
// (es parte del prefijo cacheado) y que viaje al deploy.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { MODELO_AYUDA, MODELO_LUX } from "@/lib/anthropic-mensajes";
import { olvidarPromptLux, RUTA_PROMPT_LUX, systemPromptLux } from "@/lib/lux/prompt";

beforeEach(() => olvidarPromptLux());

describe("system-prompt.md de Lux", () => {
  it("tiene las cinco secciones, en orden", () => {
    const prompt = systemPromptLux();
    const secciones = ["identidad", "material", "como_pensas", "apertura", "limites", "voz"];
    const posiciones = secciones.map((s) => prompt.indexOf(`<${s}>`));
    expect(posiciones.every((p) => p >= 0)).toBe(true);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    for (const s of secciones) expect(prompt).toContain(`</${s}>`);
  });

  it("conserva los límites que no se negocian", () => {
    const prompt = systemPromptLux();
    for (const frase of [
      "No diagnosticás ni ponés etiquetas nosológicas",
      "No indicás tratamientos, medicación ni derivaciones como instrucción",
      "No hablás de otros pacientes",
      "No inventás recuerdos de charlas anteriores",
      "lo nombrás primero, con su ancla",
      "eso es de Lupita o de la ficha",
      "leer_transcripcion",
      "<citas>",
      "propuesta",
      // Lo que leyó en la charla vuelve arriba: que no diga que lo inventó.
      "leída en esta conversación",
      "nunca digas que inventaste lo que leíste",
    ]) expect(prompt).toContain(frase);
  });

  it("no lleva nada variable: dos lecturas dan lo mismo y no hay fechas ni nombres", () => {
    const primera = systemPromptLux();
    olvidarPromptLux();
    expect(systemPromptLux()).toBe(primera);
    expect(primera).not.toMatch(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
  });

  it("viaja al deploy: next.config.ts lo incluye en la función de la ruta", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain(`"/api/pacientes/[id]/lux": ["./${RUTA_PROMPT_LUX}"]`);
  });

  it("Lux y Lupita usan Haiku 5.5", () => {
    expect(MODELO_LUX).toBe("claude-haiku-5-5");
    expect(MODELO_AYUDA).toBe("claude-haiku-5-5");
  });
});

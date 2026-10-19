// Unitario — el contrato de POST /api/ayuda (src/lib/ayuda-contrato.ts) lo
// importan la ruta y el panel. El panel corre en el navegador: el contrato no
// puede arrastrar el caso de uso (node:fs, el SDK, Prisma).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LARGO_MAX_PREGUNTA,
  LARGO_MAX_TURNO,
  MAX_TURNOS_ENVIADOS,
  MAX_TURNOS_HISTORIAL,
  preguntaAyudaSchema,
} from "@/lib/ayuda-contrato";

describe("contrato de /api/ayuda", () => {
  it("sólo importa zod", () => {
    const fuente = readFileSync(resolve(__dirname, "../ayuda-contrato.ts"), "utf8");
    const importados = [...fuente.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(importados).toEqual(["zod"]);
  });

  it("la ruta acepta el doble de turnos de los que llegan al modelo", () => {
    expect(MAX_TURNOS_ENVIADOS).toBe(MAX_TURNOS_HISTORIAL * 2);
  });

  it("acepta los topes justos y rechaza uno más", () => {
    const turno = (texto: string) => ({ rol: "usuaria" as const, texto });
    const justo = {
      pregunta: "a".repeat(LARGO_MAX_PREGUNTA),
      historial: Array.from({ length: MAX_TURNOS_ENVIADOS }, () => turno("b".repeat(LARGO_MAX_TURNO))),
    };
    expect(preguntaAyudaSchema.safeParse(justo).success).toBe(true);
    expect(preguntaAyudaSchema.safeParse({ ...justo, pregunta: "a".repeat(LARGO_MAX_PREGUNTA + 1) }).success).toBe(false);
    expect(preguntaAyudaSchema.safeParse({ ...justo, historial: [...justo.historial, turno("c")] }).success).toBe(false);
    expect(preguntaAyudaSchema.safeParse({ ...justo, historial: [turno("b".repeat(LARGO_MAX_TURNO + 1))] }).success).toBe(false);
  });
});

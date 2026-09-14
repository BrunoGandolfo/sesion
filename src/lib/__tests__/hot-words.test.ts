/**
 * El límite de palabras por término y el schema del POST de hot-words.
 *
 * Por qué importa el número: AssemblyAI ignora lo que pase de seis palabras
 * en word_boost / keyterms_prompt, así que un término más largo no mejora la
 * transcripción y encima ocupa lugar. La regla se valida en el servidor
 * (hotWordItemSchema) y se avisa en el formulario, los dos leyendo la misma
 * constante de @/lib/hot-words.
 */
import { describe, expect, it } from "vitest";

import {
  hotWordItemSchema,
  hotWordsBulkSchema,
} from "@/app/api/_lib/schemas";
import {
  contarPalabras,
  excedeMaximoPalabras,
  MAX_PALABRAS_TERMINO,
  TERMINO_MUY_LARGO,
} from "@/lib/hot-words";

const PACIENTE_ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b"; // uuid: los ids los genera la app

function palabras(n: number): string {
  return Array.from({ length: n }, (_, i) => `palabra${i + 1}`).join(" ");
}

describe("contarPalabras", () => {
  it("cuenta por espacios, no por caracteres", () => {
    expect(contarPalabras("transferencia")).toBe(1);
    expect(contarPalabras("angustia de separación")).toBe(3);
  });

  it("no cuenta el espacio de más ni el salto de línea", () => {
    expect(contarPalabras("  doble   espacio\ty salto\n")).toBe(4);
  });

  it("un término vacío no tiene palabras", () => {
    expect(contarPalabras("")).toBe(0);
    expect(contarPalabras("   ")).toBe(0);
  });
});

describe("excedeMaximoPalabras", () => {
  it("seis palabras entran, siete no", () => {
    expect(MAX_PALABRAS_TERMINO).toBe(6);
    expect(excedeMaximoPalabras(palabras(6))).toBe(false);
    expect(excedeMaximoPalabras(palabras(7))).toBe(true);
  });
});

describe("hotWordItemSchema", () => {
  it("acepta un término de seis palabras", () => {
    const parsed = hotWordItemSchema.safeParse({
      termino: palabras(6),
      scope: "global",
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza uno de siete y lo dice con el texto del límite", () => {
    const parsed = hotWordItemSchema.safeParse({
      termino: palabras(7),
      scope: "global",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0].message).toBe(TERMINO_MUY_LARGO);
  });

  it("cuenta las palabras después de recortar los espacios de los bordes", () => {
    const parsed = hotWordItemSchema.safeParse({
      termino: `   ${palabras(6)}   `,
      scope: "profesional",
    });
    expect(parsed.success).toBe(true);
  });

  it("sigue exigiendo pacienteId solo en scope paciente", () => {
    expect(
      hotWordItemSchema.safeParse({ termino: "gurí", scope: "paciente" })
        .success,
    ).toBe(false);
    expect(
      hotWordItemSchema.safeParse({
        termino: "gurí",
        scope: "paciente",
        pacienteId: PACIENTE_ID,
      }).success,
    ).toBe(true);
    expect(
      hotWordItemSchema.safeParse({
        termino: "gurí",
        scope: "global",
        pacienteId: PACIENTE_ID,
      }).success,
    ).toBe(false);
  });

  it("sigue rechazando el término vacío y el de más de 200 caracteres", () => {
    expect(
      hotWordItemSchema.safeParse({ termino: "   ", scope: "global" }).success,
    ).toBe(false);
    expect(
      hotWordItemSchema.safeParse({ termino: "a".repeat(201), scope: "global" })
        .success,
    ).toBe(false);
  });
});

describe("hotWordsBulkSchema", () => {
  it("un solo término largo tumba la lista entera", () => {
    const parsed = hotWordsBulkSchema.safeParse({
      hotWords: [
        { termino: "transferencia", scope: "global" },
        { termino: palabras(7), scope: "global" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("la lista vacía no es una carga masiva", () => {
    expect(hotWordsBulkSchema.safeParse({ hotWords: [] }).success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Categorías: la lista del schema Zod y el enum de Postgres (vía el cliente
// que genera Prisma) tienen que ser la misma. Mismo guardián que
// constantes-turno.test.ts para duración, modalidad y método de pago.
// ────────────────────────────────────────────────────────────────────────────

import { CategoriaHotWord as EnumCategoriaHotWord } from "@prisma/client";

import { CATEGORIAS_HOT_WORD } from "@/app/api/_lib/schemas";

describe("categorías del vocabulario", () => {
  it("CATEGORIAS_HOT_WORD es el enum categoria_hot_word", () => {
    expect([...CATEGORIAS_HOT_WORD].sort()).toEqual(
      Object.values(EnumCategoriaHotWord).sort(),
    );
  });

  it("una categoría fuera de la lista se rechaza al cargar el término", () => {
    const base = { termino: "ansiedad", scope: "global" as const };
    expect(hotWordItemSchema.safeParse({ ...base, categoria: "termino_clinico" }).success).toBe(true);
    expect(hotWordItemSchema.safeParse({ ...base, categoria: null }).success).toBe(true);
    expect(hotWordItemSchema.safeParse({ ...base, categoria: "cualquier cosa" }).success).toBe(false);
  });
});

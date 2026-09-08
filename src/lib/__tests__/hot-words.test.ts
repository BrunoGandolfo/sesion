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

const CUID = "clh1234567890abcdefghijkl";

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
        pacienteId: CUID,
      }).success,
    ).toBe(true);
    expect(
      hotWordItemSchema.safeParse({
        termino: "gurí",
        scope: "global",
        pacienteId: CUID,
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

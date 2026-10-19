// F6 de la revisión del worker: el resultado de un trabajo fallido dice si
// es definitivo (processor/trabajos.py, _fallo_trabajo). La app lo lee: un
// fallo definitivo deja el trabajo fallido en el primer intento, sin esperar
// al tope ni volver a pagar el modelo para recibir lo mismo.
import { describe, expect, it } from "vitest";

import { decidirResolucion } from "@/app/api/_lib/casos-uso/trabajos/resolver";
import { POLITICA_POR_TIPO } from "@/app/api/_lib/casos-uso/trabajos/politica";
import { resultadoTrabajoSchema } from "@/lib/sesion-clinica/schema";

const AHORA = new Date("2026-09-16T12:00:00Z");
const TIPOS = Object.keys(POLITICA_POR_TIPO) as (keyof typeof POLITICA_POR_TIPO)[];

describe("decidirResolucion con la marca definitivo", () => {
  it.each(TIPOS)("%s: definitivo en el primer intento → fallido", (tipo) => {
    expect(decidirResolucion({ tipo, intentos: 1 }, { ok: false, error: "llm_rechazo", definitivo: true }, AHORA))
      .toEqual({ estado: "fallido" });
  });

  it.each(TIPOS)("%s: transitorio en el primer intento → pendiente con backoff", (tipo) => {
    for (const definitivo of [false, undefined]) {
      expect(decidirResolucion({ tipo, intentos: 1 }, { ok: false, error: "timeout", definitivo }, AHORA))
        .toMatchObject({ estado: "pendiente" });
    }
  });
});

describe("resultadoTrabajoSchema", () => {
  it("conserva definitivo en un fallo", () => {
    expect(resultadoTrabajoSchema.parse({ ok: false, error: "llm_rechazo", definitivo: true }))
      .toEqual({ ok: false, error: "llm_rechazo", definitivo: true });
  });

  it("un worker que no la manda sigue siendo válido", () => {
    expect(resultadoTrabajoSchema.parse({ ok: false, error: "timeout" })).toEqual({ ok: false, error: "timeout" });
  });

  it("definitivo es booleano", () => {
    expect(resultadoTrabajoSchema.safeParse({ ok: false, error: "x", definitivo: "si" }).success).toBe(false);
  });
});

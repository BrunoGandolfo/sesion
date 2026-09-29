// Unitario: la acción clínica del turno, una sola regla para la fila, la
// card de Ahora y el detalle del turno (forense 03, P3-08).
import { describe, expect, it } from "vitest";

import { accionClinicaDe } from "@/lib/sesion-clinica/accion-clinica";
import { UMBRAL_GRABANDO_SIN_TERMINAR_MS, UMBRAL_SIN_TERMINAR_MS } from "@/lib/sesion-clinica/estados";

// 15:00 en Montevideo; "ahora" son las 15:20 del mismo día.
const INICIO = new Date("2026-09-23T18:00:00.000Z");
const AHORA = new Date("2026-09-23T18:20:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

const HOY = { estado: "programado", fecha: INICIO };
const AYER = { estado: "programado", fecha: new Date("2026-09-22T18:00:00.000Z") };

describe("accionClinicaDe", () => {
  it.each([
    ["sin sesión", null, { tipo: "grabar", retomar: false }],
    ["grabando reciente", { id: "s1", estado: "grabando", actualizadaEn: hace(60_000) }, { tipo: "grabar", retomar: false }],
    ["grabando quieta", { id: "s1", estado: "grabando", actualizadaEn: hace(UMBRAL_GRABANDO_SIN_TERMINAR_MS + 60_000) }, { tipo: "grabar", retomar: true }],
    ["subiendo reciente", { id: "s1", estado: "subiendo", actualizadaEn: hace(60_000) }, { tipo: "escribiendo" }],
    ["subiendo quieta", { id: "s1", estado: "subiendo", actualizadaEn: hace(UMBRAL_SIN_TERMINAR_MS + 60_000) }, { tipo: "grabar", retomar: true }],
    ["procesando", { id: "s1", estado: "procesando" }, { tipo: "escribiendo" }],
    ["revision", { id: "s1", estado: "revision" }, { tipo: "nota", sesionId: "s1", estado: "revision" }],
    ["aprobada", { id: "s1", estado: "aprobada" }, { tipo: "nota", sesionId: "s1", estado: "aprobada" }],
    ["fallida", { id: "s1", estado: "fallida" }, { tipo: "nota", sesionId: "s1", estado: "fallida" }],
  ])("turno de hoy, %s", (_nombre, sesion, esperada) => {
    expect(accionClinicaDe(sesion, HOY, AHORA)).toEqual(esperada);
  });

  it("un turno de otro día no se graba, pero una grabación a medias se retoma igual", () => {
    expect(accionClinicaDe(null, AYER, AHORA)).toEqual({ tipo: "ninguna" });
    expect(accionClinicaDe({ id: "s1", estado: "grabando", actualizadaEn: hace(60_000) }, AYER, AHORA)).toEqual({ tipo: "ninguna" });
    expect(
      accionClinicaDe({ id: "s1", estado: "subiendo", actualizadaEn: hace(UMBRAL_SIN_TERMINAR_MS + 60_000) }, AYER, AHORA),
    ).toEqual({ tipo: "grabar", retomar: true });
  });

  it("un turno cancelado o ausente no se graba; su nota sigue abriéndose", () => {
    for (const estado of ["cancelado", "ausente"]) {
      expect(accionClinicaDe(null, { estado, fecha: INICIO }, AHORA)).toEqual({ tipo: "ninguna" });
      expect(accionClinicaDe({ id: "s1", estado: "aprobada" }, { estado, fecha: INICIO }, AHORA).tipo).toBe("nota");
    }
  });

  it("una sesión fallida nunca ofrece grabar: el servidor contestaría 409", () => {
    expect(accionClinicaDe({ id: "s1", estado: "fallida", actualizadaEn: hace(10 ** 9) }, HOY, AHORA).tipo).toBe("nota");
  });
});

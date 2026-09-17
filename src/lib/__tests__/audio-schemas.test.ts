import { expect, test } from "vitest";
import { finalizarAudioSchema, segmentoAudioSchema } from "@/app/api/_lib/audio-schemas";
import { parsePausas } from "@/lib/sesion-clinica/schema";
const segmento = { indice: 0, inicioMs: 0, iv: "AAAAAAAAAAAAAAAA", bytes: 50, sha256: "a".repeat(64), continuacion: false };
test.each([{ key: "otra/sesion/0" }, { indice: -1 }, { iv: "corto" }, { bytes: 0 }, { bytes: 10_000_000 }, { sha256: "falso" }, { inicioMs: null }, { inicioMs: undefined }, { inicioMs: -1 }, { inicioMs: 60001 }, { inicioMs: 1 }, { inicioMs: Infinity }, { continuacion: true }, { continuacion: undefined }, { continuacion: "si" }])("rechaza descriptor o ubicación inválida %j", cambio => {
  expect(segmentoAudioSchema.safeParse({ ...segmento, ...cambio }).success).toBe(false);
});
test("conserva la medida fraccionaria del inicio", () => {
  expect(segmentoAudioSchema.parse({ ...segmento, indice: 1, inicioMs: 1100.25 }).inicioMs).toBe(1100.25);
});
test("una pieza de adentro de la corrida se declara continuación; la primera nunca", () => {
  expect(segmentoAudioSchema.parse({ ...segmento, indice: 1, inicioMs: 60_000, continuacion: true }).continuacion).toBe(true);
  expect(segmentoAudioSchema.safeParse({ ...segmento, indice: 0, continuacion: true }).success).toBe(false);
});
test("el cierre valida los límites medidos y las pausas", () => {
  const cierre = { cantidad: 2, duracionAudioSeg: 120, pausas: [{ inicio: 60000, fin: null, siguienteIndice: 1, motivo: "manual" }] };
  expect(finalizarAudioSchema.safeParse(cierre).success).toBe(true);
  expect(finalizarAudioSchema.safeParse({ ...cierre, duracionAudioSeg: 9001 }).success).toBe(false);
  expect(finalizarAudioSchema.safeParse({ ...cierre, cantidad: 0 }).success).toBe(false);
  expect(finalizarAudioSchema.safeParse({ ...cierre, pausas: [{ ...cierre.pausas[0], siguienteIndice: 3 }] }).success).toBe(false);
});
test("las lecturas conservan tanto las pausas medidas como las históricas, sin convertirlas a null", () => {
  const medida = { inicio: 60_000, fin: null, siguienteIndice: 1, motivo: "interrupcion" };
  const historica = { inicio: "2026-09-15T12:00:00Z", fin: "2026-09-15T12:05:00Z" };
  expect(parsePausas([medida, historica])).toEqual([medida, historica]);
  expect(parsePausas(JSON.stringify([medida]))).toEqual([medida]);
});

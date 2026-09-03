// Normalización al leer datos persistidos del módulo de sesión clínica.
//
// Los datos viejos NO se migran: se normalizan al leer. Este módulo es la
// única implementación runtime de esa regla; src/types/domain.ts la
// re-exporta solo por compatibilidad con los importadores existentes.

import { nivelRiesgoSchema } from "./schema";
import type {
  EvidenciaRiesgo,
  FeedbackTerapeuta,
  FeedbackTerapeutaLegacy,
  RiesgoDetectado,
} from "@/types/domain";

// ────────────────────────────────────────────────────────────────────────────
// Feedback terapeuta (contrato multi-orientación)
// ────────────────────────────────────────────────────────────────────────────

/** True si el feedback fue persistido antes del contrato multi-orientación
 *  (no tiene el discriminador `instrumento`). */
export function esFeedbackLegacy(
  raw: FeedbackTerapeuta | FeedbackTerapeutaLegacy,
): raw is FeedbackTerapeutaLegacy {
  return !("instrumento" in raw);
}

/** Normaliza un feedback leído de persistencia al contrato actual.
 *  Un legacy (pre-contrato) siempre fue MITI/CTS-R → instrumento "cbt_mi".
 *  No muta el original. */
export function normalizarFeedback(
  raw: FeedbackTerapeuta | FeedbackTerapeutaLegacy,
): FeedbackTerapeuta {
  if (esFeedbackLegacy(raw)) {
    return { ...raw, instrumento: "cbt_mi" };
  }
  return raw;
}

// ────────────────────────────────────────────────────────────────────────────
// Riesgo clínico (señal graduada)
// ────────────────────────────────────────────────────────────────────────────

function esEvidenciaRiesgoValida(value: unknown): value is EvidenciaRiesgo {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.timestamp === "string" && typeof obj.quote === "string";
}

/** Guard estructural del contrato de riesgo. Pensado para fronteras que
 *  reciben JSON no confiable (lectores de datos persistidos legacy). */
export function esRiesgoDetectadoValido(
  value: unknown,
): value is RiesgoDetectado {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    nivelRiesgoSchema.safeParse(obj.nivel).success &&
    Array.isArray(obj.indicadores) &&
    obj.indicadores.every((i) => typeof i === "string") &&
    Array.isArray(obj.evidencia) &&
    obj.evidencia.every(esEvidenciaRiesgoValida) &&
    (obj.notaParaTerapeuta === null ||
      typeof obj.notaParaTerapeuta === "string")
  );
}

/** Normaliza la señal de riesgo leída de persistencia. Ausente o inválida
 *  → nivel "ninguno" (default seguro; misma filosofía que
 *  normalizarFeedback). No muta el original. */
export function normalizarRiesgo(raw: unknown): RiesgoDetectado {
  if (esRiesgoDetectadoValido(raw)) {
    return raw;
  }
  return {
    nivel: "ninguno",
    indicadores: [],
    evidencia: [],
    notaParaTerapeuta: null,
  };
}

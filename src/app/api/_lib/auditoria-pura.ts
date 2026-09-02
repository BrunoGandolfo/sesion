// Parte PURA de la auditoría: sin imports de db ni de Prisma, para que los
// tests unitarios (vitest sin base) puedan importarla. auditoria.ts la
// re-exporta; el código de rutas importa desde ahí.

import { createHash } from "node:crypto";

export type ActorAuditoria = "usuario" | "worker" | "sistema";

export interface EventoAuditoriaInput {
  organizationId: string;
  actorTipo: ActorAuditoria;
  actorId?: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle?: Record<string, unknown>;
}

/** Largo máximo de un string dentro de `detalle`. */
export const DETALLE_MAX_STRING = 120;
/** Cantidad máxima de elementos de un array dentro de `detalle`. */
export const DETALLE_MAX_ARRAY = 20;

// Claves que NUNCA van al registro de auditoría, sin importar el valor:
// texto clínico, datos personales y material criptográfico. La lista es
// deliberadamente amplia — el registro sirve para saber que algo pasó, no
// qué decía.
const CLAVES_PROHIBIDAS: ReadonlySet<string> = new Set([
  "nota",
  "transcripcion",
  "texto",
  "nombre",
  "apellido",
  "telefono",
  "email",
  "subjetivo",
  "objetivo",
  "analisis",
  "plan",
  "detalle",
  "quote",
  "resumen",
  "hipotesis",
  "datosEstructurados",
  "claveCifrado",
  "iv",
]);

type Primitivo = string | number | boolean | null;

function primitivoSeguro(value: unknown): Primitivo | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return value.length > DETALLE_MAX_STRING
      ? value.slice(0, DETALLE_MAX_STRING)
      : value;
  }
  return undefined;
}

/**
 * Función PURA. Devuelve una copia de `detalle` apta para persistir:
 *   - conserva solo primitivos (string truncado a 120 chars, number finito,
 *     boolean, null) y arrays de primitivos cortos (≤ 20 elementos, cada uno
 *     con las mismas reglas; los elementos no primitivos se descartan);
 *   - descarta objetos anidados y cualquier otro tipo (funciones, undefined…);
 *   - elimina las claves de la lista negra (texto clínico / PII / criptografía).
 * Con `undefined` devuelve `undefined`; con un objeto que queda vacío devuelve
 * `{}` (se persiste igual: la ausencia de detalle también es información).
 */
export function detalleSeguro(
  detalle: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (detalle === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(detalle)) {
    if (CLAVES_PROHIBIDAS.has(clave)) continue;
    if (Array.isArray(valor)) {
      const items: Primitivo[] = [];
      for (const item of valor) {
        if (items.length >= DETALLE_MAX_ARRAY) break;
        const p = primitivoSeguro(item);
        if (p !== undefined) items.push(p);
      }
      out[clave] = items;
      continue;
    }
    const p = primitivoSeguro(valor);
    if (p !== undefined) out[clave] = p;
  }
  return out;
}

/**
 * sha256 hex de un texto. Permite registrar "hubo edición" / "esta es la
 * versión aprobada" sin guardar el texto clínico en el registro.
 */
export function hashTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

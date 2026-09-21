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
  /** Momento del acto. Sin esto la fila lo pone sola (now()); se pasa cuando
   *  el caso de uso ya tiene un reloj y todo el acto lleva la misma hora. */
  creadoEn?: Date;
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
  // IP y navegador viven en sesiones_acceso e intentos_acceso, con purga a
  // 30 días. El rastro clínico es para siempre y no los lleva.
  "ip",
  "ipOrigen",
  "userAgent",
  "user_agent",
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
 * Devuelve una copia de `detalle` apta para persistir:
 *   - conserva solo primitivos (string truncado a 120 chars, number finito,
 *     boolean, null) y arrays de primitivos cortos (≤ 20 elementos, cada uno
 *     con las mismas reglas; los elementos no primitivos se descartan);
 *   - descarta objetos anidados y cualquier otro tipo (funciones, undefined…);
 *   - elimina las claves de la lista negra (texto clínico / PII / criptografía).
 * Con `undefined` devuelve `undefined`; con un objeto que queda vacío devuelve
 * `{}` (se persiste igual: la ausencia de detalle también es información).
 *
 * ─── POR QUÉ AVISA ──────────────────────────────────────────────────────────
 *
 * El filtro descartaba en silencio. El 18 de septiembre el diagnóstico del
 * grabador viajaba como objeto anidado: nunca llegó a la tabla y nadie se
 * enteró, porque la ruta respondía 200 y la fila quedaba con un detalle a
 * medias. Ahora cada descarte deja una línea en el log con el NOMBRE de la
 * clave —nunca el valor, que es justo lo que el filtro existe para no dejar
 * salir— y se distinguen las dos causas, que se arreglan distinto:
 *
 *   "forma"     el valor no es primitivo (un objeto anidado, casi siempre).
 *               Es un error de quien llama: hay que aplanarlo antes.
 *   "prohibida" la clave está en la lista negra. El filtro hizo su trabajo;
 *               el aviso está para que no se confunda con lo anterior.
 *
 * Deja de ser una función pura en sentido estricto —escribe en el log—, pero
 * lo que devuelve sigue dependiendo sólo de lo que recibe, y sigue sin
 * importar db ni Prisma: los tests unitarios la importan igual.
 */
export function detalleSeguro(
  detalle: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (detalle === undefined) return undefined;
  const out: Record<string, unknown> = {};
  const prohibidas: string[] = [];
  const porForma: string[] = [];
  for (const [clave, valor] of Object.entries(detalle)) {
    if (CLAVES_PROHIBIDAS.has(clave)) {
      prohibidas.push(clave);
      continue;
    }
    if (Array.isArray(valor)) {
      const items: Primitivo[] = [];
      let descartados = 0;
      for (const item of valor) {
        if (items.length >= DETALLE_MAX_ARRAY) break;
        const p = primitivoSeguro(item);
        if (p === undefined) descartados += 1;
        else items.push(p);
      }
      if (descartados > 0) porForma.push(`${clave}[]`);
      out[clave] = items;
      continue;
    }
    const p = primitivoSeguro(valor);
    if (p === undefined) porForma.push(clave);
    else out[clave] = p;
  }
  avisar("forma", porForma);
  avisar("prohibida", prohibidas);
  return out;
}

/** Una línea por causa, con los nombres de las claves y ningún valor. */
function avisar(causa: "forma" | "prohibida", claves: string[]): void {
  if (claves.length === 0) return;
  console.warn(
    causa === "forma"
      ? `[auditoria] detalle: descartado por forma (no es primitivo ni array de primitivos): ${claves.join(", ")}`
      : `[auditoria] detalle: descartado por clave prohibida: ${claves.join(", ")}`,
  );
}

/**
 * sha256 hex de un texto. Permite registrar "hubo edición" / "esta es la
 * versión aprobada" sin guardar el texto clínico en el registro.
 */
export function hashTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

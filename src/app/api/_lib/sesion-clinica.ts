// Helpers compartidos por las rutas de /api/sesion-clinica/**.
//
// - assertTransicionValida: puente entre la tabla de transiciones (única
//   fuente de verdad en src/lib/sesion-clinica-utils.ts) y ApiError.
// - extraerClaveTemporal / extraerCriptoTemporal / sinClaveTemporal: manejo
//   del stash `_audioCifradoTemporal` dentro de datosEstructurados (escrito
//   por upload, leído por pendientes, re-adjuntado por callback, borrado por
//   aprobar). Todos toleran el campo como objeto (descifrado por la
//   extensión Prisma) o como string JSON (filas legacy).

import { esTransicionValida } from "@/lib/sesion-clinica-utils";

import { ApiError } from "./responses";

export function assertTransicionValida(desde: string, hacia: string): void {
  if (!esTransicionValida(desde, hacia)) {
    throw new ApiError(`Transición inválida: ${desde} → ${hacia}`, 400);
  }
}

/**
 * Parsea datosEstructurados de forma tolerante: acepta objeto ya
 * deserializado o string JSON; devuelve null si está ausente, no parsea o
 * no es un objeto plano.
 */
export function parseDatosEstructuradosRaw(
  raw: unknown,
): Record<string, unknown> | null {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** Stash crudo de la clave temporal del audio, o null si no hay. */
export function extraerClaveTemporal(raw: unknown): unknown {
  const obj = parseDatosEstructuradosRaw(raw);
  if (!obj) return null;
  return obj._audioCifradoTemporal ?? null;
}

/** Clave + IV del stash, ya tipados; null en cada uno si faltan. */
export function extraerCriptoTemporal(raw: unknown): {
  claveCifrado: string | null;
  iv: string | null;
} {
  const stash = extraerClaveTemporal(raw);
  if (typeof stash !== "object" || stash === null) {
    return { claveCifrado: null, iv: null };
  }
  const clave = (stash as Record<string, unknown>).claveCifrado;
  const iv = (stash as Record<string, unknown>).ivCifrado;
  return {
    claveCifrado: typeof clave === "string" ? clave : null,
    iv: typeof iv === "string" ? iv : null,
  };
}

/**
 * Stash de la clave temporal del audio en datosEstructurados, conservando lo
 * que ya hubiera. Lo escribe upload-url (antes lo hacía el /upload
 * monolítico); lo leen pendientes y callback; lo borra aprobar. El contrato
 * con el worker (claveCifrado + ivCifrado dentro de _audioCifradoTemporal)
 * no cambia.
 */
export function conClaveTemporal(
  datosActuales: unknown,
  claveCifrado: string,
  iv: string,
): string {
  const actual = parseDatosEstructuradosRaw(datosActuales) ?? {};
  return JSON.stringify({
    ...actual,
    // TODO: mover clave + IV a una columna propia cifrada por la extensión
    // (migración humana). Mientras tanto vive acá, cifrada en reposo por la
    // extensión Prisma como parte de datosEstructurados.
    _audioCifradoTemporal: {
      claveCifrado,
      ivCifrado: iv,
      guardadoEn: "datosEstructurados",
      actualizadoEn: new Date().toISOString(),
    },
  });
}

/**
 * Versión de la fila apta para responder al cliente: datosEstructurados
 * como OBJETO (o null) y SIN `_audioCifradoTemporal`. La clave del audio
 * es material criptográfico del pipeline; nunca debe salir por la API de
 * la UI.
 */
export function sinClaveTemporal<T extends { datosEstructurados?: unknown }>(
  row: T,
): T {
  const obj = parseDatosEstructuradosRaw(row.datosEstructurados);
  if (!obj) {
    return { ...row, datosEstructurados: null };
  }
  const { _audioCifradoTemporal: _clave, ...resto } = obj;
  return { ...row, datosEstructurados: resto };
}

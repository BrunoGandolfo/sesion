// Helpers compartidos por las rutas de /api/sesion-clinica/**.
//
// - assertTransicionValida: puente entre la tabla de transiciones (única
//   fuente de verdad en src/lib/sesion-clinica-utils.ts) y ApiError.
// - extraerClaveTemporal / extraerCriptoTemporal / sinClaveTemporal: manejo
//   del stash `_audioCifradoTemporal` dentro de datosEstructurados (escrito
//   por upload, leído por pendientes, re-adjuntado por callback, borrado por
//   aprobar). Todos toleran el campo como objeto (descifrado por la
//   extensión Prisma) o como string JSON (filas legacy).

import {
  notaSoapOriginalSchema,
  parseDatosEstructurados,
  sesionClinicaResponseSchema,
  type SesionClinicaResponse,
} from "@/lib/sesion-clinica/schema";
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
  const resto: Record<string, unknown> = { ...obj };
  delete resto._audioCifradoTemporal;
  return { ...row, datosEstructurados: resto };
}

// ────────────────────────────────────────────────────────────────────────────
// Select único de sesión clínica para la UI y mapper a la respuesta.
//
// SESION_SELECT es el superset de los selects que hoy repiten GET/PATCH [id],
// upload-confirmar, aprobar y GET ?turnoId. NUNCA transcripcion (PHI que la
// UI no necesita). `notaSoapOriginal` es un campo lógico de la extensión de
// cifrado sin columna propia en el tipo generado: por eso no se puede usar
// `satisfies Prisma.SesionClinicaSelect` y el objeto vive en una const (TS
// no chequea propiedades sobrantes en no-literales).
// ────────────────────────────────────────────────────────────────────────────

export const SESION_SELECT = {
  id: true,
  turnoId: true,
  estado: true,
  duracionAudioSeg: true,
  audioR2Key: true,
  audioBorradoEn: true,
  notaSubjetivo: true,
  notaObjetivo: true,
  notaAnalisis: true,
  notaPlan: true,
  notaSoapOriginal: true,
  datosEstructurados: true,
  modeloASR: true,
  modeloLLM: true,
  promptVersion: true,
  hablanteTerapeuta: true,
  procesadoEn: true,
  aprobadoEn: true,
  error: true,
  intentos: true,
  createdAt: true,
  updatedAt: true,
  turno: {
    select: {
      id: true,
      fecha: true,
      paciente: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          telefono: true,
        },
      },
    },
  },
} as const;

/** Fila de Prisma leída con SESION_SELECT (o un subconjunto sin `turno`). */
export interface FilaSesionClinica {
  id: string;
  turnoId: string;
  estado: string;
  duracionAudioSeg: number | null;
  audioR2Key: string | null;
  audioBorradoEn: Date | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  /** Campo lógico de la extensión: objeto SOAP con secciones nullable, o null. */
  notaSoapOriginal?: unknown;
  /** Objeto (extensión) o string JSON (fila legacy). */
  datosEstructurados?: unknown;
  modeloASR: string | null;
  modeloLLM: string | null;
  promptVersion: string | null;
  hablanteTerapeuta: string | null;
  procesadoEn: Date | null;
  aprobadoEn: Date | null;
  error: string | null;
  intentos: number;
  createdAt: Date;
  updatedAt: Date;
  turno?: {
    id: string;
    fecha: Date;
    paciente: {
      id: string;
      nombre: string;
      apellido: string;
      telefono?: string;
    };
  } | null;
}

function aIso(fecha: Date | null | undefined): string | null {
  return fecha ? fecha.toISOString() : null;
}

/**
 * Fila de Prisma → respuesta para la UI. Quita la clave temporal del audio
 * (sinClaveTemporal), parsea datosEstructurados si vino como string, serializa
 * fechas a ISO y valida contra sesionClinicaResponseSchema antes de devolver:
 * si algo no cumple el contrato, lanza en el servidor en vez de mandar una
 * forma inesperada al cliente.
 */
export function toSesionClinicaResponse(
  fila: FilaSesionClinica,
): SesionClinicaResponse {
  const limpia = sinClaveTemporal(fila);
  const original = notaSoapOriginalSchema
    .nullable()
    .safeParse(limpia.notaSoapOriginal ?? null);

  return sesionClinicaResponseSchema.parse({
    id: limpia.id,
    turnoId: limpia.turnoId,
    estado: limpia.estado,
    duracionAudioSeg: limpia.duracionAudioSeg,
    audioR2Key: limpia.audioR2Key,
    audioBorradoEn: aIso(limpia.audioBorradoEn),
    notaSubjetivo: limpia.notaSubjetivo,
    notaObjetivo: limpia.notaObjetivo,
    notaAnalisis: limpia.notaAnalisis,
    notaPlan: limpia.notaPlan,
    notaSoapOriginal: original.success ? original.data : null,
    datosEstructurados: parseDatosEstructurados(limpia.datosEstructurados),
    modeloASR: limpia.modeloASR,
    modeloLLM: limpia.modeloLLM,
    promptVersion: limpia.promptVersion,
    hablanteTerapeuta: limpia.hablanteTerapeuta,
    procesadoEn: aIso(limpia.procesadoEn),
    aprobadoEn: aIso(limpia.aprobadoEn),
    error: limpia.error,
    intentos: limpia.intentos,
    createdAt: limpia.createdAt.toISOString(),
    updatedAt: limpia.updatedAt.toISOString(),
    ...(limpia.turno
      ? {
          turno: {
            id: limpia.turno.id,
            fecha: limpia.turno.fecha.toISOString(),
            paciente: {
              id: limpia.turno.paciente.id,
              nombre: limpia.turno.paciente.nombre,
              apellido: limpia.turno.paciente.apellido,
              ...(limpia.turno.paciente.telefono !== undefined
                ? { telefono: limpia.turno.paciente.telefono }
                : {}),
            },
          },
        }
      : {}),
  });
}

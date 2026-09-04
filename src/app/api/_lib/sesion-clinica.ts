// Helpers compartidos por las rutas de /api/sesion-clinica/**.
//
// - assertTransicionValida: puente entre la tabla de transiciones (única
//   fuente de verdad en src/lib/sesion-clinica-utils.ts) y ApiError.
// - extraerClaveTemporal / extraerCriptoTemporal / sinClaveTemporal: manejo
//   del stash `_audioCifradoTemporal` dentro de datosEstructurados (escrito
//   por upload, leído por pendientes, re-adjuntado por callback, borrado por
//   aprobar). Toleran el campo como objeto (descifrado por la extensión
//   Prisma) o como string JSON.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import {
  notaSoapOriginalSchema,
  parseDatosEstructurados,
  parsePausas,
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
 * no cambia. Devuelve el string JSON listo para cifrarSesion.
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
    // (migración humana). Mientras tanto vive acá, cifrada en reposo como
    // parte de datosEstructurados.
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
// SESION_SELECT es el superset de los selects de GET/PATCH [id],
// upload-confirmar, aprobar y GET ?turnoId. NUNCA transcripcion (PHI que la
// UI no necesita). Los campos lógicos cifrados (notaSubjetivo, …,
// notaSoapOriginal, datosEstructurados) son campos calculados de la
// extensión de cifrado, así que el cliente extendido los conoce y los tipa.
// ────────────────────────────────────────────────────────────────────────────

export const SESION_SELECT = {
  id: true,
  turnoId: true,
  estado: true,
  duracionAudioSeg: true,
  audioR2Key: true,
  audioBorradoEn: true,
  pausas: true,
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
} satisfies Prisma.Args<typeof db.sesionClinica, "findFirst">["select"];

/** Fila exacta que devuelve Prisma para SESION_SELECT. */
type FilaSesionSelect = Prisma.Result<
  typeof db.sesionClinica,
  { select: typeof SESION_SELECT },
  "findFirstOrThrow"
>;

type TurnoDeFila = FilaSesionSelect["turno"];

/**
 * Fila leída con SESION_SELECT o un subconjunto: sin `turno` (selects sin
 * relación) o con paciente sin `telefono` (GET ?turnoId). Además,
 * toSesionClinicaResponse tolera `datosEstructurados` como string JSON,
 * `pausas` como JSON crudo y `notaSoapOriginal` con forma inesperada (salen
 * null), por eso esos tres quedan abiertos.
 */
export type FilaSesionClinica = Omit<
  FilaSesionSelect,
  "turno" | "notaSoapOriginal" | "datosEstructurados" | "pausas"
> & {
  notaSoapOriginal?: unknown;
  datosEstructurados?: unknown;
  pausas?: unknown;
  turno?:
    | (Omit<TurnoDeFila, "paciente"> & {
        paciente: Omit<TurnoDeFila["paciente"], "telefono"> & {
          telefono?: string;
        };
      })
    | null;
};

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
    pausas: parsePausas(limpia.pausas),
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

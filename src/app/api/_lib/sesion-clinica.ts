// Select único de la sesión clínica para la UI y mapper a la respuesta.
//
// SESION_SELECT es lo que devuelven GET [id], GET ?turnoId y todas las
// operaciones de usuaria (aprobar, reprocesar, reintentar, pedir "Para vos").
// NUNCA trae la transcripción (tiene endpoint propio, con auditoría de cada
// lectura) ni la clave del audio (material criptográfico del pipeline). La
// key de R2 no existe como columna: se calcula (estados.ts).
//
// Las columnas cifradas que sí trae (nota IA, datos, feedback, nota final,
// comentarios) se abren en toSesionClinicaResponse con el único módulo del
// área que sabe de cifrado (casos-uso/sesion/cifrado.ts).

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import {
  parseDatosEstructurados,
  parsePausas,
  sesionClinicaResponseSchema,
  type SesionClinicaResponse,
} from "@/lib/sesion-clinica/schema";

import { descifrarSesion } from "./casos-uso/sesion/cifrado";

export const SESION_SELECT = {
  id: true,
  turnoId: true,
  estado: true,
  audioEstado: true,
  audioBorradoEn: true,
  duracionAudioSeg: true,
  pausas: true,
  intento: true,
  generacion: true,
  falloCodigo: true,
  falloDetalle: true,
  // `modeloAsr` se escribe en el mismo UPDATE que la transcripción (el
  // checkpoint): sirve de "hay transcripción" sin traer el blob.
  modeloAsr: true,
  modeloLlm: true,
  promptVersion: true,
  procesadaEn: true,
  aprobadaEn: true,
  feedbackEstado: true,
  feedbackError: true,
  notaIaEncrypted: true,
  datosEncrypted: true,
  feedbackEncrypted: true,
  notaFinalEncrypted: true,
  notasEdicionEncrypted: true,
  creadaEn: true,
  actualizadaEn: true,
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
} satisfies Prisma.SesionClinicaSelect;

/** Fila exacta que devuelve Prisma para SESION_SELECT. */
type FilaSesionSelect = Prisma.Result<
  typeof db.sesionClinica,
  { select: typeof SESION_SELECT },
  "findFirstOrThrow"
>;

type TurnoDeFila = FilaSesionSelect["turno"];

/**
 * Fila leída con SESION_SELECT o un subconjunto: sin `turno` (selects sin
 * relación) o con paciente sin `telefono` (GET ?turnoId). `pausas` queda
 * abierta porque el mapper tolera JSON crudo.
 */
export type FilaSesionClinica = Omit<FilaSesionSelect, "turno" | "pausas"> & {
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
 * Fila de Prisma → respuesta para la UI. Descifra los campos que la pantalla
 * muestra, serializa fechas a ISO y valida contra sesionClinicaResponseSchema
 * antes de devolver: si algo no cumple el contrato, lanza en el servidor en
 * vez de mandar una forma inesperada al cliente.
 */
export function toSesionClinicaResponse(
  fila: FilaSesionClinica,
): SesionClinicaResponse {
  const campos = descifrarSesion(fila.id, fila);

  return sesionClinicaResponseSchema.parse({
    id: fila.id,
    turnoId: fila.turnoId,
    estado: fila.estado,
    audioEstado: fila.audioEstado,
    audioBorradoEn: aIso(fila.audioBorradoEn),
    duracionAudioSeg: fila.duracionAudioSeg,
    pausas: parsePausas(fila.pausas),
    intento: fila.intento,
    generacion: fila.generacion,
    falloCodigo: fila.falloCodigo,
    falloDetalle: fila.falloDetalle,
    transcripcionDisponible: fila.modeloAsr !== null,
    notaIa: campos.notaIa ?? null,
    notaFinal: campos.notaFinal ?? null,
    notasEdicion: campos.notasEdicion ?? null,
    datos: parseDatosEstructurados(campos.datos),
    feedbackEstado: fila.feedbackEstado,
    feedback: campos.feedback ?? null,
    feedbackError: fila.feedbackError,
    modeloAsr: fila.modeloAsr,
    modeloLlm: fila.modeloLlm,
    promptVersion: fila.promptVersion,
    procesadaEn: aIso(fila.procesadaEn),
    aprobadaEn: aIso(fila.aprobadaEn),
    creadaEn: fila.creadaEn.toISOString(),
    actualizadaEn: fila.actualizadaEn.toISOString(),
    ...(fila.turno
      ? {
          turno: {
            id: fila.turno.id,
            fecha: fila.turno.fecha.toISOString(),
            paciente: {
              id: fila.turno.paciente.id,
              nombre: fila.turno.paciente.nombre,
              apellido: fila.turno.paciente.apellido,
              ...(fila.turno.paciente.telefono !== undefined
                ? { telefono: fila.turno.paciente.telefono }
                : {}),
            },
          },
        }
      : {}),
  });
}

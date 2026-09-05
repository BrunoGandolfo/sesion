// Caso de uso: reintentar el procesamiento de una sesión en error
// (transición error → procesando pedida por el cliente vía PATCH).
//
// El worker (processor/) levanta las sesiones en "procesando" vía
// /pendientes, así que la transición re-encola sola. Sin audio en R2 no hay
// nada que procesar y la sesión quedaría colgada en "procesando" para
// siempre: por eso se exige audio. Se limpia el error anterior y se resetea
// `intentos` (lease y tope de /pendientes); sin el reset, una sesión que
// agotó los reintentos volvería a "error" en el primer poll.

import type { db } from "@/lib/db";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { ApiError } from "../responses";
import {
  assertTransicionValida,
  SESION_SELECT,
  type FilaSesionClinica,
} from "../sesion-clinica";

type ClientePrisma = typeof db;

export interface ReintentarSesionInput {
  prisma: ClientePrisma;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  /** Valores opcionales que el PATCH puede traer junto con el reintento. */
  audioR2Key?: string;
  duracionAudioSeg?: number;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

/** Devuelve la fila actualizada (con SESION_SELECT), lista para la respuesta. */
export async function reintentarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  audioR2Key,
  duracionAudioSeg,
  registrarAuditoria,
}: ReintentarSesionInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: { id: true, estado: true, audioR2Key: true },
  });

  if (!existente) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  assertTransicionValida(existente.estado, "procesando");

  if (!audioR2Key && !existente.audioR2Key) {
    throw new ApiError(
      "No hay audio subido para reintentar el procesamiento. Descartá la sesión y volvé a grabar.",
      409,
    );
  }

  // La organización va en el WHERE de la ESCRITURA, no sólo en el findFirst
  // de arriba: `update({ where: { id } })` escribe la fila aunque sea de otra
  // organización, y entre la lectura y la escritura hay una ventana. Con
  // updateMany la pertenencia es parte de la operación.
  const { count } = await prisma.sesionClinica.updateMany({
    where: { id: sesionId, organizationId },
    data: {
      estado: "procesando",
      duracionAudioSeg,
      audioR2Key,
      error: null,
      intentos: 0,
    },
  });

  if (count === 0) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  const sesion = await prisma.sesionClinica.findFirstOrThrow({
    where: { id: sesionId, organizationId },
    select: SESION_SELECT,
  });

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.cambiar_estado",
    entidad: "sesion_clinica",
    entidadId: sesion.id,
    detalle: { desde: existente.estado, hacia: "procesando" },
  });

  return sesion;
}

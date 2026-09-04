// Caso de uso: DELETE de una sesión clínica. Tres ramas con nombre, según
// el estado en que está la sesión:
//   - descartarNotaEnRevision: revision → error, conservando transcripción,
//     audio y la clave temporal (la sesión queda reprocesable).
//   - eliminarSesionConError: borrado definitivo, solo si el audio en R2 se
//     pudo borrar (o no había).
//   - resolverGrabacionAbandonada: huérfana en "grabando"; con audio pasa a
//     error, sin audio se elimina.
// Cualquier otro estado → ApiError 409.

import type { db } from "@/lib/db";
import { cifrarSesion } from "@/lib/prisma-encryption";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { ApiError } from "../responses";
import { assertTransicionValida, extraerClaveTemporal } from "../sesion-clinica";

type ClientePrisma = typeof db;

export interface EliminarSesionInput {
  prisma: ClientePrisma;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  /** Borrado best-effort del audio en R2: true si ya no queda audio. */
  borrarAudio: (audioR2Key: string | null) => Promise<boolean>;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export type ResultadoEliminarSesion =
  | { tipo: "nota_descartada"; audioConservado: boolean }
  | { tipo: "grabacion_abandonada_a_error" }
  | { tipo: "eliminada" };

export const MENSAJE_AUDIO_NO_BORRADO =
  "No se pudo borrar el audio en R2; la sesión se conserva para reintentar la eliminación";

type SesionExistente = {
  id: string;
  estado: string;
  audioR2Key: string | null;
  datosEstructurados: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type Contexto = Omit<EliminarSesionInput, "sesionId"> & {
  existente: SesionExistente;
};

function tieneAudioReal(audioR2Key: string | null): boolean {
  return Boolean(audioR2Key && audioR2Key !== "dev-no-r2");
}

function auditar(
  ctx: Contexto,
  accion: "sesion.descartar" | "sesion.eliminar",
  audioConservado: boolean,
): Promise<void> {
  return ctx.registrarAuditoria({
    organizationId: ctx.organizationId,
    actorTipo: "usuario",
    actorId: ctx.usuarioId,
    accion,
    entidad: "sesion_clinica",
    entidadId: ctx.existente.id,
    detalle: { estadoPrevio: ctx.existente.estado, audioConservado },
  });
}

// Nota en revisión: descartar ≠ destruir. Se limpia SOLO lo generado por el
// LLM (nota SOAP + datos estructurados); la transcripción y el audio NO se
// tocan acá. La fila queda en "error", el único estado reprocesable
// (error → procesando vía PATCH re-encola al worker).
async function descartarNotaEnRevision(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente } = ctx;
  assertTransicionValida(existente.estado, "error");
  const audioConservado = tieneAudioReal(existente.audioR2Key);
  // Se limpia todo lo generado (las 4 secciones en null dejan la nota SOAP
  // en NULL), pero el stash de la clave temporal se preserva: es lo único
  // necesario para reprocesar.
  const claveTemporal = extraerClaveTemporal(existente.datosEstructurados);
  await prisma.sesionClinica.update({
    where: { id: existente.id },
    data: {
      estado: "error",
      error: audioConservado
        ? "Nota descartada por la usuaria. La transcripción y el audio se conservan: podés reprocesar o eliminar definitivamente."
        : "Nota descartada por la usuaria. La transcripción se conserva; no hay audio para reprocesar.",
      ...cifrarSesion({
        notaSubjetivo: null,
        notaObjetivo: null,
        notaAnalisis: null,
        notaPlan: null,
        datosEstructurados: claveTemporal
          ? JSON.stringify({ _audioCifradoTemporal: claveTemporal })
          : null,
      }),
    },
  });

  await auditar(ctx, "sesion.descartar", audioConservado);

  return { tipo: "nota_descartada", audioConservado };
}

// Sesión en error: descarte definitivo. Ningún otro modelo referencia
// SesionClinica (es el lado dependiente de la 1:1 con Turno), así que el
// delete es seguro y libera el turno para volver a grabar. Si el audio real
// no se pudo borrar de R2, la fila NO se elimina: audioR2Key es el único
// puntero al blob y perderlo lo dejaría huérfano e imborrable.
async function eliminarSesionConError(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente, borrarAudio } = ctx;
  const audioBorrado = await borrarAudio(existente.audioR2Key);
  if (!audioBorrado && tieneAudioReal(existente.audioR2Key)) {
    await prisma.sesionClinica.update({
      where: { id: existente.id },
      data: { error: MENSAJE_AUDIO_NO_BORRADO },
    });
    throw new ApiError(MENSAJE_AUDIO_NO_BORRADO, 409);
  }
  await prisma.sesionClinica.delete({ where: { id: existente.id } });

  await auditar(ctx, "sesion.eliminar", false);

  return { tipo: "eliminada" };
}

// Grabación abandonada (huérfana en "grabando"): el umbral se valida
// server-side para no permitir descartar una grabación activa. Con audio
// subido se conserva fila y audio (a error: desde ahí se puede reintentar o
// descartar definitivamente); sin audio no hay nada que conservar y la
// eliminación libera el turno.
async function resolverGrabacionAbandonada(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente } = ctx;
  if (existente.audioR2Key) {
    assertTransicionValida(existente.estado, "error");
    await prisma.sesionClinica.update({
      where: { id: existente.id },
      data: {
        estado: "error",
        error: "Grabación abandonada — descartada por la usuaria",
      },
    });

    await auditar(ctx, "sesion.descartar", true);

    return { tipo: "grabacion_abandonada_a_error" };
  }

  await prisma.sesionClinica.delete({ where: { id: existente.id } });

  await auditar(ctx, "sesion.eliminar", false);

  return { tipo: "eliminada" };
}

export async function eliminarSesion(
  input: EliminarSesionInput,
): Promise<ResultadoEliminarSesion> {
  const { prisma, sesionId, organizationId } = input;

  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: {
      id: true,
      estado: true,
      audioR2Key: true,
      datosEstructurados: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existente) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  const ctx: Contexto = { ...input, existente };

  if (existente.estado === "revision") {
    return descartarNotaEnRevision(ctx);
  }

  if (existente.estado === "error") {
    return eliminarSesionConError(ctx);
  }

  if (existente.estado === "grabando" && esSesionHuerfana(existente)) {
    return resolverGrabacionAbandonada(ctx);
  }

  throw new ApiError(
    `Solo se puede descartar una nota en revisión, una sesión con error o una grabación abandonada (estado actual: ${existente.estado})`,
    409,
  );
}

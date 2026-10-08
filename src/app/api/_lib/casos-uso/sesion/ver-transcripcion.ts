// Ver la transcripción: fuera del GET general a propósito (la nota se abre
// muchas veces, la transcripción pocas) y con evento de auditoría propio,
// para que quede rastro de cada lectura del texto literal. Disponible en
// cualquier estado con transcripción (revision, aprobada, fallida tras el
// checkpoint, procesando en un reproceso).
//
// Estricto, como abrir la nota (ver.ts): el consentimiento promete que cada
// vez que se abre la transcripción queda registrado. La lectura y
// sesion.ver_transcripcion van en UNA transacción; si el rastro no se puede
// escribir, la transcripción no sale (500 "Error interno").

import { ACCIONES } from "@/lib/auditoria-acciones";

import { auditar } from "../../auditoria";
import { ApiError } from "../../responses";

import { MENSAJE_NO_ENCONTRADA, type ClienteTransaccional } from "./transicion";
import type { ClienteAuditoria } from "../../auditoria";

/** Convención del worker: la terapeuta es siempre el hablante S0. */
export const HABLANTE_TERAPEUTA = "S0";

export interface VerTranscripcionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  /** Quién la leyó por ella. Sin esto, la abrió ella en la pantalla. */
  via?: "lux";
}

/**
 * El rastro de UNA lectura de transcripción. Lo usan esta ruta y Lux
 * (casos-uso/lux/material.ts), siempre con el `tx` de la lectura: sin rastro
 * no hay transcripción.
 */
export async function auditarLecturaTranscripcion(tx: ClienteAuditoria, lectura: {
  organizationId: string; usuarioId: string; sesionId: string;
  estado: string; caracteres: number; via?: "lux";
}) {
  await auditar(tx, {
    organizationId: lectura.organizationId,
    actorTipo: "usuario",
    actorId: lectura.usuarioId,
    accion: ACCIONES.sesion.verTranscripcion,
    entidad: "sesion_clinica",
    entidadId: lectura.sesionId,
    detalle: {
      estado: lectura.estado, caracteres: lectura.caracteres,
      ...(lectura.via ? { via: lectura.via } : {}),
    },
  });
}

export interface TranscripcionVisible {
  transcripcion: string;
  hablanteTerapeuta: string;
}

export async function verTranscripcion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  via,
}: VerTranscripcionInput): Promise<TranscripcionVisible> {
  return prisma.$transaction(async (tx) => {
    const sesion = await tx.sesionClinica.findFirst({
      where: { id: sesionId, organizationId },
      // `transcripcion` es el campo lógico: la extensión lo descifra al leer.
      select: { id: true, estado: true, transcripcion: true },
    });
    if (!sesion) throw new ApiError(MENSAJE_NO_ENCONTRADA, 404);

    const transcripcion = sesion.transcripcion;
    if (!transcripcion) {
      throw new ApiError("La sesión todavía no tiene transcripción", 409);
    }

    await auditarLecturaTranscripcion(tx, {
      organizationId, usuarioId, sesionId,
      estado: sesion.estado, caracteres: transcripcion.length, via,
    });

    return { transcripcion, hablanteTerapeuta: HABLANTE_TERAPEUTA };
  });
}

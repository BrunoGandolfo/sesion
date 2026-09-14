// El worker creó el transcript en AssemblyAI: se anota su id y, en la misma
// transacción, el trabajo `borrar_transcript_asr` que lo va a borrar con
// reintentos aunque el proceso muera antes del resultado (H-11). Idempotente
// por transcriptId: registrar dos veces el mismo no duplica el trabajo.

import type { EventoAuditoriaInput } from "../../auditoria-pura";
import { crearTrabajo } from "../trabajos/crear";

import { transicionar, type ClienteTransaccional } from "./transicion";

export interface RegistrarAsrInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  intento: number;
  transcriptId: string;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export async function registrarAsr({
  prisma,
  sesionId,
  organizationId,
  intento,
  transcriptId,
  registrarAuditoria,
}: RegistrarAsrInput): Promise<{ trabajoId: string }> {
  const trabajo = await prisma.$transaction(async (tx) => {
    await transicionar({
      prisma: tx,
      operacion: "registrar_asr",
      sesionId,
      organizationId,
      intento,
      data: { asrTranscriptId: transcriptId },
    });
    const existente = await tx.trabajo.findFirst({
      where: {
        sesionId,
        tipo: "borrar_transcript_asr",
        payload: { path: ["transcriptId"], equals: transcriptId },
      },
      select: { id: true },
    });
    if (existente) return existente;
    return crearTrabajo({
      prisma: tx,
      tipo: "borrar_transcript_asr",
      payload: { transcriptId },
      organizationId,
      sesionId,
    });
  });

  await registrarAuditoria({
    organizationId,
    actorTipo: "worker",
    actorId: null,
    accion: "sesion.asr_creado",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: { intento, trabajoId: trabajo.id },
  });

  return { trabajoId: trabajo.id };
}

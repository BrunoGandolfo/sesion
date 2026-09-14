// Ver la transcripción: fuera del GET general a propósito (la nota se abre
// muchas veces, la transcripción pocas) y con evento de auditoría propio,
// para que quede rastro de cada lectura del texto literal. Disponible en
// cualquier estado con transcripción (revision, aprobada, fallida tras el
// checkpoint, procesando en un reproceso).

import type { EventoAuditoriaInput } from "../../auditoria-pura";
import { ApiError } from "../../responses";

import type { ClienteSesion } from "./transicion";

/** Convención del worker: la terapeuta es siempre el hablante S0. */
export const HABLANTE_TERAPEUTA = "S0";

export interface VerTranscripcionInput {
  prisma: ClienteSesion;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
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
  registrarAuditoria,
}: VerTranscripcionInput): Promise<TranscripcionVisible> {
  const sesion = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    // `transcripcion` es el campo lógico: la extensión lo descifra al leer.
    select: { id: true, estado: true, transcripcion: true },
  });
  if (!sesion) throw new ApiError("Sesión clínica no encontrada", 404);

  const transcripcion = sesion.transcripcion;
  if (!transcripcion) {
    throw new ApiError("La sesión todavía no tiene transcripción", 409);
  }

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.ver_transcripcion",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: { estado: sesion.estado, caracteres: transcripcion.length },
  });

  return { transcripcion, hablanteTerapeuta: HABLANTE_TERAPEUTA };
}

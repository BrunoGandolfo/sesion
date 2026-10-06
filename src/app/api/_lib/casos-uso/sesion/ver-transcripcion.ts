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

/** Convención del worker: la terapeuta es siempre el hablante S0. */
export const HABLANTE_TERAPEUTA = "S0";

export interface VerTranscripcionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
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

    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.sesion.verTranscripcion,
      entidad: "sesion_clinica",
      entidadId: sesionId,
      detalle: { estado: sesion.estado, caracteres: transcripcion.length },
    });

    return { transcripcion, hablanteTerapeuta: HABLANTE_TERAPEUTA };
  });
}

// Registro de auditoría (tabla eventos_auditoria, append-only).
//
// Reglas:
//   - Se llama DESPUÉS de la operación principal exitosa y con `await`, pero
//     nunca hace fallar la respuesta: cualquier error se loguea y se traga.
//   - `detalle` pasa SIEMPRE por detalleSeguro: nada de texto clínico, nombres
//     ni material criptográfico llega a la tabla (ver auditoria-pura.ts).
//   - La app nunca hace update/delete sobre eventoAuditoria.

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { detalleSeguro } from "./auditoria-pura";
import type { EventoAuditoriaInput } from "./auditoria-pura";

export {
  detalleSeguro,
  hashTexto,
  DETALLE_MAX_ARRAY,
  DETALLE_MAX_STRING,
} from "./auditoria-pura";
export type { ActorAuditoria, EventoAuditoriaInput } from "./auditoria-pura";

export async function registrarAuditoria(
  evento: EventoAuditoriaInput,
): Promise<void> {
  try {
    await db.eventoAuditoria.create({
      data: {
        organizationId: evento.organizationId,
        actorTipo: evento.actorTipo,
        actorId: evento.actorId ?? null,
        accion: evento.accion,
        entidad: evento.entidad,
        entidadId: evento.entidadId,
        // detalleSeguro garantiza que solo hay primitivos y arrays de
        // primitivos: es JSON válido por construcción.
        detalle: detalleSeguro(evento.detalle) as
          | Prisma.InputJsonObject
          | undefined,
      },
    });
  } catch (error) {
    // Sin `throw`: la auditoría no puede voltear la operación que audita.
    console.error("[auditoria] fallo", evento.accion, error);
  }
}

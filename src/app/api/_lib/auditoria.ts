// Registro de auditoría (tabla eventos_auditoria, append-only).
//
// UNA sola función escribe la fila: `auditar(prisma, evento)`. Lo que se
// inyecta es el CLIENTE —el `tx` de una transacción o el `db` global—, nunca
// la función: antes había tres formas de auditar (la función inyectada, la
// función importada y un `tx.eventoAuditoria.create` a mano) y las tres
// terminaban en el mismo INSERT, así que la inyección no compraba nada.
//
// ─── LAS DOS FORMAS, Y CUÁNDO VA CADA UNA ───────────────────────────────────
//
//   auditar(tx, evento)              El rastro es parte del acto.
//   registrarAuditoria(db, evento)   El rastro es informativo.
//
// `auditar` FALLA con quien la llama. Para los actos legales —firmar y
// revocar la autorización de grabación, exportar documentación clínica— se le
// pasa el `tx` de la transacción del acto: o se confirman los dos, o no
// ocurre ninguno. Un acto hecho sin rastro no es aceptable; un acto que no se
// hizo, sí (la usuaria lo vuelve a intentar).
//
// `registrarAuditoria` envuelve a `auditar` y se traga el error, para los
// eventos INFORMATIVOS (una pregunta a la ayuda, un reintento del worker, un
// checkpoint): ahí el rastro es diagnóstico y voltear la operación que audita
// sería peor que perderlo. El fallo queda en el log de la función.
//
// Reglas que valen para las dos:
//   - `detalle` pasa SIEMPRE por detalleSeguro: nada de texto clínico,
//     nombres ni material criptográfico llega a la tabla (auditoria-pura.ts).
//   - La app nunca hace update/delete sobre eventoAuditoria.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";

import { detalleSeguro } from "./auditoria-pura";
import type { EventoAuditoriaInput } from "./auditoria-pura";

export {
  detalleSeguro,
  hashTexto,
  DETALLE_MAX_ARRAY,
  DETALLE_MAX_STRING,
} from "./auditoria-pura";
export type { ActorAuditoria, EventoAuditoriaInput } from "./auditoria-pura";

/** Lo mínimo que necesita escribir un evento: `db` o el `tx` de cualquier
 *  transacción lo cumplen. */
export type ClienteAuditoria = Pick<typeof db, "eventoAuditoria">;

/**
 * Escribe el evento con el cliente que se le da y FALLA con quien la llama.
 * Con el `tx` de una transacción, el rastro se confirma junto con el acto.
 */
export async function auditar(
  prisma: ClienteAuditoria,
  evento: EventoAuditoriaInput,
): Promise<void> {
  await prisma.eventoAuditoria.create({
    data: {
      organizationId: evento.organizationId,
      actorTipo: evento.actorTipo,
      actorId: evento.actorId ?? null,
      accion: evento.accion,
      entidad: evento.entidad,
      entidadId: evento.entidadId,
      ...(evento.creadoEn ? { creadoEn: evento.creadoEn } : {}),
      // detalleSeguro garantiza que solo hay primitivos y arrays de
      // primitivos: es JSON válido por construcción.
      detalle: detalleSeguro(evento.detalle) as
        | Prisma.InputJsonObject
        | undefined,
    },
  });
}

/**
 * Eventos INFORMATIVOS: escribe y, si no puede, lo deja en el log sin
 * voltear la operación que audita. Para un acto legal va `auditar`.
 */
export async function registrarAuditoria(
  prisma: ClienteAuditoria,
  evento: EventoAuditoriaInput,
): Promise<void> {
  try {
    await auditar(prisma, evento);
  } catch (error) {
    // Sin `throw`: la auditoría informativa no puede voltear su operación.
    console.error("[auditoria] fallo", evento.accion, error);
  }
}

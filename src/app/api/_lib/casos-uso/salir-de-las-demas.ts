// "Cerrar las demás sesiones": todas las de la usuaria menos la actual, y el
// rastro, en UNA transacción. Vivía en la ruta, con la auditoría después y
// fuera del acto.

import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import { cerrarTodas } from "@/lib/sesion-acceso";

import { auditar } from "../auditoria";

export interface SalirDeLasDemasInput {
  prisma: Pick<typeof db, "$transaction">;
  organizationId: string;
  userId: string;
  /** La sesión desde la que se pide: queda abierta. */
  sesionId: string;
  ahora?: Date;
}

/** Devuelve cuántas cerró. */
export async function salirDeLasDemas({
  prisma,
  organizationId,
  userId,
  sesionId,
  ahora = new Date(),
}: SalirDeLasDemasInput): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const cerradas = await cerrarTodas(tx, { userId, motivo: "salida_todas", ahora, exceptoId: sesionId });
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: ACCIONES.cuenta.salidaTodas,
      entidad: "usuario",
      entidadId: userId,
      creadoEn: ahora,
      detalle: { cerradas },
    });
    return cerradas;
  });
}

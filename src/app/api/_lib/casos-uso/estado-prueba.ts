import type { db } from "@/lib/db";
import { estadoPrueba, type EstadoPrueba } from "@/lib/limites-prueba";

/** Cuántas grabaciones lleva un consultorio de prueba; null si no es de prueba. */
export async function leerEstadoPrueba({
  prisma,
  organizationId,
}: {
  prisma: typeof db;
  organizationId: string;
}): Promise<EstadoPrueba | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { deInvitacion: true, grabacionesIniciadas: true },
  });
  return org ? estadoPrueba(org) : null;
}

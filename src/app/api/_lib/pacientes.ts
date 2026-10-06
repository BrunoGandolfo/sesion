// "La paciente es de esta organización, o 404": UNA sola vez para toda la API.
// Antes estaba escrito siete veces (rutas, hilo, consentimiento, alta de
// turno, recordar cobro, exportar el Recorrido), cada una con su select y su
// mensaje.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";

import { ApiError } from "./responses";

export const MENSAJE_PACIENTE_NO_ENCONTRADO = "Paciente no encontrado";

/**
 * Lee la paciente con la organización en el WHERE y lanza 404 si no está (no
 * existe o es de otra organización: para quien pregunta es lo mismo). Sin
 * `select` devuelve sólo el id; con `select`, esas columnas. Acepta `db` o el
 * `tx` de una transacción.
 */
export async function requirePaciente<S extends Prisma.PacienteSelect = { id: true }>(
  prisma: Pick<typeof db, "paciente">,
  id: string,
  organizationId: string,
  select?: S,
): Promise<Prisma.PacienteGetPayload<{ select: S }>> {
  const paciente = await prisma.paciente.findFirst({
    where: { id, organizationId },
    select: select ?? { id: true },
  });
  if (!paciente) {
    throw new ApiError(MENSAJE_PACIENTE_NO_ENCONTRADO, 404);
  }
  return paciente as unknown as Prisma.PacienteGetPayload<{ select: S }>;
}

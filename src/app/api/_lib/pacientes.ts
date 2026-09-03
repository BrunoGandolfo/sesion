// Helpers compartidos por las rutas de /api/pacientes/**.

import type { db } from "@/lib/db";

import { ApiError } from "./responses";

type Cliente = typeof db;

/**
 * Verifica que el paciente exista y pertenezca a la organización; si no,
 * lanza el mismo 404 "Paciente no encontrado" que repetían las rutas. Devuelve
 * solo el id: las rutas que necesitan más columnas hacen su propio select.
 */
export async function requirePaciente(
  prisma: Cliente,
  id: string,
  organizationId: string,
): Promise<{ id: string }> {
  const paciente = await prisma.paciente.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!paciente) {
    throw new ApiError("Paciente no encontrado", 404);
  }
  return paciente;
}

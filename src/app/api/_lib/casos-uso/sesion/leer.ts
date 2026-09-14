// Lectura de una sesión con SESION_SELECT, después de una operación de
// usuaria: lo que la ruta devuelve. Con la organización en el WHERE.

import { ApiError } from "../../responses";
import { SESION_SELECT, type FilaSesionClinica } from "../../sesion-clinica";

import type { ClienteSesion } from "./transicion";

export async function leerSesion(
  prisma: ClienteSesion,
  sesionId: string,
  organizationId: string,
): Promise<FilaSesionClinica> {
  const sesion = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: SESION_SELECT,
  });
  if (!sesion) throw new ApiError("Sesión clínica no encontrada", 404);
  return sesion;
}

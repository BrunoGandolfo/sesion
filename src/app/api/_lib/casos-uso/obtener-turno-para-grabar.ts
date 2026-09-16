import { consentimientoVigenteDe } from "@/lib/consentimiento";
import type { db } from "@/lib/db";

/** Datos de la pantalla de grabación, limitados a la organización del actor. */
export async function obtenerTurnoParaGrabar({
  prisma,
  organizationId,
  turnoId,
}: {
  prisma: typeof db;
  organizationId: string;
  turnoId: string;
}) {
  const turno = await prisma.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: {
      id: true,
      fecha: true,
      paciente: { select: { id: true, nombre: true, apellido: true } },
    },
  });
  if (!turno) return null;

  return {
    ...turno,
    autorizacionVigente: await consentimientoVigenteDe(
      prisma,
      turno.paciente.id,
      organizationId,
    ),
  };
}

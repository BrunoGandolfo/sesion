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
  const [turno, configuracion] = await Promise.all([
    prisma.turno.findFirst({
      where: { id: turnoId, organizationId },
      select: {
        id: true,
        fecha: true,
        paciente: { select: { id: true, nombre: true, apellido: true } },
      },
    }),
    // La autorización se firma en la propia pantalla de grabar: el texto del
    // consentimiento lleva el nombre de la profesional y la dirección.
    prisma.configuracion.findUnique({ where: { organizationId }, select: { nombreProfesional: true, direccion: true } }),
  ]);
  if (!turno) return null;

  return {
    ...turno,
    nombreProfesional: configuracion?.nombreProfesional ?? "",
    direccionConsultorio: configuracion?.direccion ?? "",
    autorizacionVigente: await consentimientoVigenteDe(
      prisma,
      turno.paciente.id,
      organizationId,
    ),
  };
}

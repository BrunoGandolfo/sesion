import { db } from "@/lib/db";
import { finDeMesMvd, inicioDeMesMvd } from "@/lib/fechas-montevideo";

import { getOrganizationId } from "../../_lib/auth";
import { toTurnoConPaciente } from "../../_lib/domain";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cobros (turnos pagados) del mes actual, ordenados por pagoFecha DESC.
 *
 * El endpoint /api/turnos filtra por `fecha` del turno, no por `pagoFecha`,
 * así que para la vista "Cobros del mes" del pilar Finanzas hace falta una
 * consulta dedicada: un turno realizado en abril y cobrado en mayo tiene
 * que aparecer en la vista de mayo.
 */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const now = new Date();
    const monthStart = inicioDeMesMvd(now);
    const monthEnd = finDeMesMvd(now);

    const turnos = await db.turno.findMany({
      where: {
        organizationId,
        pagoEstado: "pagado",
        pagoFecha: { gte: monthStart, lte: monthEnd },
      },
      include: {
        paciente: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
          },
        },
      },
      orderBy: { pagoFecha: "desc" },
    });

    return ok(turnos.map(toTurnoConPaciente));
  } catch (error) {
    return errorResponse(error);
  }
}

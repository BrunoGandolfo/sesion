import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { cobrosDelMes } from "../../_lib/casos-uso/turnos";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

/** Cobros (turnos pagados) del mes actual, por pagoFecha DESC. La consulta
 *  y el porqué de filtrar por fecha de pago están en casos-uso/turnos.ts. */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const turnos = await cobrosDelMes({
      prisma: db,
      organizationId,
      enElMesDe: new Date(),
    });

    return ok(turnos);
  } catch (error) {
    return errorResponse(error);
  }
}

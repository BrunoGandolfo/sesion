import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { cobrosDelMes } from "../../_lib/casos-uso/turnos";
import { bordeMvd } from "../../_lib/periodo";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

/**
 * Cobros (turnos pagados) de un mes, por pagoFecha DESC. La consulta y el
 * porqué de filtrar por fecha de pago están en casos-uso/turnos.ts.
 *
 * `?mes=AAAA-MM` (o un día: `AAAA-MM-DD`, y se toma su mes) elige el mes, en
 * hora de Montevideo. SIN el parámetro contesta el mes actual, igual que
 * siempre: es lo que pide la pantalla de Cobros hoy.
 *
 * Existe para el detalle de Finanzas: al tocar la barra de un mes hay que
 * poder pedir los cobros de ESE mes (docs/contrato-finanzas.md).
 */
export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const mes = new URL(request.url).searchParams.get("mes");

    const turnos = await cobrosDelMes({
      prisma: db,
      organizationId,
      enElMesDe: mes ? bordeMvd(mes, "desde") : new Date(),
    });

    return ok(turnos);
  } catch (error) {
    return errorResponse(error);
  }
}

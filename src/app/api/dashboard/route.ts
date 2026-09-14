import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { obtenerDashboard } from "../_lib/casos-uso/obtener-dashboard";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** La pantalla Hoy. Qué se lee y cómo se compone está en
 *  casos-uso/obtener-dashboard.ts. */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const data = await obtenerDashboard({
      prisma: db,
      organizationId,
      ahora: new Date(),
    });

    return ok(data);
  } catch (error) {
    return errorResponse(error);
  }
}

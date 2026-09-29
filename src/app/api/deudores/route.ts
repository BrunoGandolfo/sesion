import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { listarDeudores } from "../_lib/casos-uso/deudores";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

/** Lista completa de deudores, sin tope y en el mismo orden que Hoy. La
 *  cuenta y el orden están en casos-uso/deudores.ts. */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    return ok(await listarDeudores({ prisma: db, organizationId, ahora: new Date() }));
  } catch (error) {
    return errorResponse(error);
  }
}

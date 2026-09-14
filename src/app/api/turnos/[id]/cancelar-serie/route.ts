import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import { cancelarRestoDeSerie } from "../../../_lib/casos-uso/cancelar-serie-turno";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

/** Cancela este turno y los siguientes de su serie que sigan programados.
 *  La regla (qué se toca y qué no) está en casos-uso/cancelar-serie-turno.ts. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const resultado = await cancelarRestoDeSerie({
      prisma: db,
      organizationId,
      turnoId: id,
    });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

import { db } from "@/lib/db";

import { getSessionActor } from "../../../../_lib/auth";
import { reintentarFeedback } from "../../../../_lib/casos-uso/sesion/reintentar-feedback";
import { errorResponse, ok } from "../../../../_lib/responses";
import { toSesionClinicaResponse } from "../../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const sesion = await reintentarFeedback({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
    });
    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

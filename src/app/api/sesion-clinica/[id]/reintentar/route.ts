import { db } from "@/lib/db";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { reintentarSesion } from "../../../_lib/casos-uso/sesion/reintentar";
import { errorResponse, ok } from "../../../_lib/responses";
import { toSesionClinicaResponse } from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const sesion = await reintentarSesion({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
      registrarAuditoria,
    });
    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

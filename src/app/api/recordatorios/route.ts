// Recordatorios de un turno.
//
// Existe para que el detalle del turno pueda decir si el aviso salió, quedó
// pendiente o falló — y, si falló, ofrecer el reintento (POST
// /api/recordatorios/[id]/reintentar). Hasta ahora la pantalla no tenía
// forma de enterarse: el payload del turno no trae los recordatorios y no
// hay GET /api/turnos/[id].

import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { toRecordatorio } from "../_lib/domain";
import { ApiError, errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const turnoId = new URL(request.url).searchParams.get("turnoId")?.trim();

    if (!turnoId) {
      throw new ApiError("Falta turnoId", 400);
    }

    // El recordatorio no tiene organizationId propio: lo hereda del turno, y
    // por eso el turno se busca SIEMPRE con la organización de la sesión.
    const turno = await db.turno.findFirst({
      where: { id: turnoId, organizationId },
      select: { id: true },
    });

    if (!turno) {
      throw new ApiError("Turno no encontrado", 404);
    }

    const recordatorios = await db.recordatorio.findMany({
      where: { turnoId },
      orderBy: { programadoEn: "desc" },
    });

    return ok(recordatorios.map(toRecordatorio));
  } catch (error) {
    return errorResponse(error);
  }
}

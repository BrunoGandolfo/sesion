// POST /api/cuenta/salir-todas → cierra todas las sesiones menos la actual.
import { db } from "@/lib/db";

import { getSessionActor } from "../../_lib/auth";
import { salirDeLasDemas } from "../../_lib/casos-uso/salir-de-las-demas";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST() {
  try {
    const actor = await getSessionActor();
    const cerradas = await salirDeLasDemas({
      prisma: db,
      organizationId: actor.organizationId,
      userId: actor.userId,
      sesionId: actor.sesionId,
    });
    return ok({ cerradas });
  } catch (error) {
    return errorResponse(error);
  }
}

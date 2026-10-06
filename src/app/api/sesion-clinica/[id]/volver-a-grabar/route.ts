// subiendo → grabando: el teléfono repite una subida que falló (paso 2 o 3)
// pidiendo otra URL. Ruta con nombre, como las demás transiciones de la
// usuaria; sin body, el estado de partida va en el WHERE.

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { volverAGrabar } from "../../../_lib/casos-uso/audio";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const sesion = await volverAGrabar({ prisma: db, organizationId, sesionId: id, usuarioId: userId });

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}

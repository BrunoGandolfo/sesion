// GET: la sesión para la UI, sin transcripción (tiene ruta propia). No hay
// PATCH ni DELETE: cada transición es una ruta con nombre (aprobar,
// reprocesar, reintentar, eliminar, feedback/reintentar, volver-a-grabar) que
// escribe con el estado de partida en el WHERE.
//
// Abrirla deja sesion.ver en la misma transacción que la lectura: si el
// rastro no se puede escribir, la nota no sale (casos-uso/sesion/ver.ts).

import { db } from "@/lib/db";

import { getSessionActor } from "../../_lib/auth";
import { verSesion } from "../../_lib/casos-uso/sesion/ver";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    return ok(await verSesion({ prisma: db, organizationId, sesionId: id, usuarioId: userId }));
  } catch (error) {
    return errorResponse(error);
  }
}

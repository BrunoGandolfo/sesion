// GET: la sesión para la UI, sin transcripción (tiene ruta propia). No hay
// PATCH ni DELETE: cada transición es una ruta con nombre (aprobar,
// reprocesar, reintentar, eliminar, feedback/reintentar) que escribe con el
// estado de partida en el WHERE.

import { db } from "@/lib/db";

import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import { leerSesion } from "../../_lib/casos-uso/sesion/leer";
import { errorResponse, ok } from "../../_lib/responses";
import { toSesionClinicaResponse } from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const sesion = await leerSesion(db, id, organizationId);

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.ver",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: { estado: sesion.estado },
    });

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

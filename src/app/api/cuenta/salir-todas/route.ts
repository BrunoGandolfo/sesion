// POST /api/cuenta/salir-todas → cierra todas las sesiones menos la actual.
import { db } from "@/lib/db";
import { cerrarTodas } from "@/lib/sesion-acceso";

import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST() {
  try {
    const actor = await getSessionActor();
    const cerradas = await cerrarTodas(db, {
      userId: actor.userId,
      motivo: "salida_todas",
      ahora: new Date(),
      exceptoId: actor.sesionId,
    });
    await registrarAuditoria({
      organizationId: actor.organizationId,
      actorTipo: "usuario",
      actorId: actor.userId,
      accion: "cuenta.salida_todas",
      entidad: "usuario",
      entidadId: actor.userId,
      detalle: { cerradas },
    });
    return ok({ cerradas });
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/cuenta/invitaciones → cuántas invitaciones quedan y, si hoy no se
// puede generar, por qué.
// POST /api/cuenta/invitaciones → un enlace de invitación. Solo quien tiene
// el permiso (puedeInvitar), con los límites de src/lib/limites-prueba.ts;
// deja evento de auditoría.
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { db } from "@/lib/db";

import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import { consultarInvitaciones, crearInvitacion } from "../../_lib/casos-uso/registrar-cuenta";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const actor = await getSessionActor();
    const respuesta = ok(await consultarInvitaciones(
      { userId: actor.userId, email: actor.email, rol: actor.rol },
      repositorioRegistro(db),
    ));
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const actor = await getSessionActor();
    const creada = await crearInvitacion(
      { userId: actor.userId, email: actor.email, rol: actor.rol },
      repositorioRegistro(db),
    );
    // Sin token ni email: solo que se creó y cuándo vence.
    await registrarAuditoria({
      organizationId: actor.organizationId,
      actorTipo: "usuario",
      actorId: actor.userId,
      accion: "cuenta.invitacion_creada",
      entidad: "usuario",
      entidadId: actor.userId,
      detalle: { invitacionId: creada.invitacionId, vence: creada.vence },
    });
    const respuesta = ok({ enlace: creada.enlace, vence: creada.vence });
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

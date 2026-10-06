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
import { errorResponse, okSinCache } from "../../_lib/responses";
import { ACCIONES } from "@/lib/auditoria-acciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const actor = await getSessionActor();
    return okSinCache(await consultarInvitaciones(
      { userId: actor.userId, email: actor.email, rol: actor.rol },
      repositorioRegistro(db),
    ));
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
    await registrarAuditoria(db, {
      organizationId: actor.organizationId,
      actorTipo: "usuario",
      actorId: actor.userId,
      accion: ACCIONES.cuenta.invitacionCreada,
      entidad: "usuario",
      entidadId: actor.userId,
      detalle: { invitacionId: creada.invitacionId, vence: creada.vence },
    });
    return okSinCache({ enlace: creada.enlace, vence: creada.vence });
  } catch (error) {
    return errorResponse(error);
  }
}

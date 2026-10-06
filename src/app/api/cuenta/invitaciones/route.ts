// GET /api/cuenta/invitaciones → cuántas invitaciones quedan y, si hoy no se
// puede generar, por qué.
// POST /api/cuenta/invitaciones → un enlace de invitación. Solo quien tiene
// el permiso (puedeInvitar), con los límites de src/lib/limites-prueba.ts;
// deja evento de auditoría.
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { db } from "@/lib/db";

import { getSessionActor } from "../../_lib/auth";
import { consultarInvitaciones, crearInvitacion } from "../../_lib/casos-uso/registrar-cuenta";
import { errorResponse, okSinCache } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const actor = await getSessionActor();
    return okSinCache(await consultarInvitaciones(actor, repositorioRegistro(db)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const actor = await getSessionActor();
    const creada = await crearInvitacion(actor, { repo: repositorioRegistro(db), auditoria: db });
    return okSinCache({ enlace: creada.enlace, vence: creada.vence });
  } catch (error) {
    return errorResponse(error);
  }
}

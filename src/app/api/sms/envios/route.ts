// GET /api/sms/envios?turnoId=<id> — los SMS de un turno, para la pantalla.
//
// Con sesión (queda dentro del matcher del proxy: sólo /api/sms/callback
// y /api/sms/entrante son públicos, porque los llama Twilio). Reemplaza a
// GET /api/recordatorios?turnoId=: mismo uso, sobre envios_sms, con el
// estado real (aceptado no es entregado) y el motivo en castellano cuando no
// salió. No hay POST /reintentar: con backoff hasta la ventana útil, un
// `fallido` ya agotó todo lo que había para intentar.

import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { enviosDelTurno } from "../../_lib/casos-uso/envios-del-turno";
import { ApiError, errorResponse, ok } from "../../_lib/responses";

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
    return ok(await enviosDelTurno(db, organizationId, turnoId));
  } catch (error) {
    return errorResponse(error);
  }
}

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { avisoDelTurno } from "../../../_lib/casos-uso/recordatorios-whatsapp";
import { errorResponse, okSinCache } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ turnoId: string }>;
};

/** El aviso por WhatsApp del turno, para el detalle: `{ avisadoEn }` (la
 *  última apertura para su fecha vigente, o null). 404 si el turno no es de
 *  su organización. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await getSessionActor();
    const { turnoId } = await params;
    return okSinCache(await avisoDelTurno({ prisma: db, organizationId, turnoId }));
  } catch (error) {
    return errorResponse(error);
  }
}

// GET: las notas que el panel tiene que avisarle a esta usuaria (en proceso,
// listas o fallidas sin abrir). Solo lectura y sin auditoría: la consulta el
// panel cada tanto y no lee nada clínico. Contrato en
// _lib/casos-uso/avisos-notas.ts.

import { db } from "@/lib/db";

import { getSessionActor } from "../../_lib/auth";
import { avisosNotas } from "../../_lib/casos-uso/avisos-notas";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const { organizationId, userId } = await getSessionActor();
    return ok(
      await avisosNotas({ prisma: db, organizationId, userId, ahora: new Date() }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

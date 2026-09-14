// POST /api/pacientes/[id]/recordar-cobro — pide el aviso de cobro por SMS.
//
// Lo aprieta ella desde Cobros, una paciente por vez. Acá sólo auth y la
// respuesta: la regla (cuánto debe, si tiene teléfono, si pidió la baja) vive
// en _lib/casos-uso/recordar-cobro.ts. No se habla con Twilio en esta
// request: se crea el envío y lo manda el cron de despacho.

import { db } from "@/lib/db";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { recordarCobro } from "../../../_lib/casos-uso/recordar-cobro";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const resultado = await recordarCobro({
      prisma: db,
      organizationId,
      pacienteId: id,
      usuarioId: userId,
      registrarAuditoria,
    });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/pacientes/[id]/recordar-cobro — el aviso de cobro por SMS.
//
// Lo aprieta ella desde Cobros, una paciente por vez. Acá sólo auth, el
// cliente de Twilio y la respuesta: la regla (cuánto debe, qué dice el
// mensaje, qué se audita) vive en _lib/casos-uso/recordar-cobro.ts.

import { db } from "@/lib/db";
import { sendSms } from "@/lib/recordatorios-sms";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { recordarCobro } from "../../../_lib/casos-uso/recordar-cobro";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      enviarSms: sendSms,
      registrarAuditoria,
    });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

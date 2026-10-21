// POST /api/pacientes/[id]/recordar-cobro — pide el aviso de cobro por el
// canal de Tu consultorio.
//
// Lo aprieta ella desde Cobros, una paciente por vez. Acá sólo auth y la
// respuesta: la regla (cuánto debe, si tiene teléfono, si pidió la baja, qué
// canal) vive en _lib/casos-uso/recordar-cobro.ts. No se habla con Twilio en
// esta request: por SMS se crea el envío y lo manda el cron de despacho; por
// WhatsApp se anota que ella abrió el enlace y se devuelve el enlace.

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { recordarCobro } from "../../../_lib/casos-uso/recordar-cobro";
import { errorResponse, leerJson, ok, validationError } from "../../../_lib/responses";
import { recordarCobroSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const conCuerpo = request.headers.get("content-type")?.includes("application/json") ?? false;
    const parsed = recordarCobroSchema.safeParse(conCuerpo ? await leerJson(request) : {});
    if (!parsed.success) return validationError(parsed.error);

    const resultado = await recordarCobro({
      prisma: db,
      organizationId,
      pacienteId: id,
      usuarioId: userId,
      canal: parsed.data.canal,
    });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

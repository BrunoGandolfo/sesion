// POST /api/pacientes/[id]/recordar-cobro — anota que abrió el aviso de
// cobro por WhatsApp.
//
// Lo aprieta ella desde Cobros, una paciente por vez. Acá sólo auth y la
// respuesta: la regla (cuánto debe, si tiene teléfono) vive en
// _lib/casos-uso/recordar-cobro.ts, que anota la apertura y devuelve el
// enlace. Sin cuerpo, o `{}`.

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
    });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

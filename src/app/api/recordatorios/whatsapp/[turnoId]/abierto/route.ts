import { db } from "@/lib/db";

import { getSessionActor } from "../../../../_lib/auth";
import { registrarAviso } from "../../../../_lib/casos-uso/recordatorios-whatsapp";
import { errorResponse, leerJson, ok, validationError } from "../../../../_lib/responses";
import { avisoWhatsappAbiertoSchema } from "../../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ turnoId: string }>;
};

/** Abrió el enlace de WhatsApp del turno. Cuerpo opcional `{ fecha }` (la
 *  del enlace que abrió); sin cuerpo JSON, la fecha vigente del turno. 201
 *  cada vez: repetir registra otra apertura. 404 si el turno no es de su
 *  organización. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await getSessionActor();
    const { turnoId } = await params;
    const conCuerpo = request.headers.get("content-type")?.includes("application/json") ?? false;
    const parsed = avisoWhatsappAbiertoSchema.safeParse(conCuerpo ? await leerJson(request) : {});
    if (!parsed.success) return validationError(parsed.error);

    const aviso = await registrarAviso({
      prisma: db,
      organizationId: actor.organizationId,
      turnoId,
      usuarioId: actor.userId,
      ahora: new Date(),
      fechaTurno: parsed.data.fecha ? new Date(parsed.data.fecha) : undefined,
    });
    return ok(aviso, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

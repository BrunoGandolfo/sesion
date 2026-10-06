// Paso 3 de la subida: el único cierre de la grabación. El servidor pregunta
// a R2 (HeadObject) si el objeto está; si no, la sesión vuelve a grabando y
// responde 409 (codigo "audio_no_llego") para que el teléfono repita. Si
// está, subiendo → procesando. El rastro de los dos desenlaces lo deja el
// caso de uso.

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { exigirR2 } from "../../../_lib/exigir-r2";
import { confirmarSubida } from "../../../_lib/casos-uso/audio";
import { errorResponse, leerJson, ok, validationError } from "../../../_lib/responses";
import { uploadConfirmarSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const parsed = uploadConfirmarSchema.safeParse(await leerJson(request));
    if (!parsed.success) return validationError(parsed.error);

    const almacen = exigirR2();
    return ok(await confirmarSubida({ prisma: db, organizationId, sesionId: id, usuarioId: userId, ...parsed.data, almacen }));
  } catch (error) {
    return errorResponse(error);
  }
}

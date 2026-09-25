// POST /api/sesion-clinica/[id]/abandonar — la usuaria descarta una
// grabación sin terminar (grabando/subiendo). Con audio en R2 queda
// `fallida` y el audio se borra; sin audio, la sesión se borra. La regla
// vive en casos-uso/sesion/abandonar.ts.
import { db } from "@/lib/db";
import { almacenAudio, r2Configurado } from "@/lib/r2";

import { getSessionActor } from "../../../_lib/auth";
import { abandonarSesion } from "../../../_lib/casos-uso/sesion/abandonar";
import { ApiError, errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    // Sin R2 no se puede saber si el audio llegó: no se adivina.
    if (!r2Configurado()) {
      throw new ApiError("El almacenamiento de audio (R2) no está configurado en este entorno", 503);
    }
    const resultado = await abandonarSesion({
      prisma: db,
      almacen: almacenAudio,
      sesionId: id,
      organizationId,
      actor: { tipo: "usuario", id: userId },
    });
    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

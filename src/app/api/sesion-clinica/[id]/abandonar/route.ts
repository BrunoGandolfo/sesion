// POST /api/sesion-clinica/[id]/abandonar — la usuaria descarta una
// grabación sin terminar (grabando/subiendo). La sesión se borra siempre y,
// si el audio llegó a R2, se encola su borrado. La regla vive en
// casos-uso/sesion/abandonar.ts.
import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { exigirR2 } from "../../../_lib/exigir-r2";
import { descartarSesion } from "../../../_lib/casos-uso/sesion/abandonar";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    // Sin R2 no se puede saber si el audio llegó: no se adivina.
    const almacen = exigirR2();
    const resultado = await descartarSesion({
      prisma: db,
      almacen,
      sesionId: id,
      organizationId,
      usuarioId: userId,
    });
    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

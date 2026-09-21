// El worker entrega el resultado de una sesión: nota, o fallo (transitorio
// o definitivo). Semántica para el worker: 2xx cierra; 409 y 4xx son
// terminales (no reintentar); 5xx o sin respuesta: el lease decide.

import { db } from "@/lib/db";
import { resultadoSesionSchema } from "@/lib/sesion-clinica/schema";

import { identidadWorker, registrarLatido } from "../../../_lib/casos-uso/sesion/latido";
import { aplicarResultadoSesion } from "../../../_lib/casos-uso/sesion/resultado";
import { errorResponse, ok, validationError } from "../../../_lib/responses";
import { autorizarTicketSesion } from "../../../_lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const sesion = await autorizarTicketSesion(request, db, id);
    const parsed = resultadoSesionSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const resultado = await aplicarResultadoSesion({
      prisma: db,
      sesionId: sesion.sesionId,
      organizationId: sesion.organizationId,
      resultado: parsed.data,
    });
    await registrarLatido({ prisma: db, ...identidadWorker(request), ahora: new Date(), tipo: "trabajo" });
    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

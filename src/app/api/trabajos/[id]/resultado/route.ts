import { db } from "@/lib/db";
import { resultadoTrabajoSchema } from "@/lib/sesion-clinica/schema";

import { identidadWorker, registrarLatido } from "../../../_lib/casos-uso/sesion/latido";
import { aplicarResultadoTrabajo } from "../../../_lib/casos-uso/trabajos/resultado-worker";
import { errorResponse, ok, validationError } from "../../../_lib/responses";
import { autorizarTicketTrabajo } from "../../../_lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const trabajo = await autorizarTicketTrabajo(request, db, id);
    const parsed = resultadoTrabajoSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const resolucion = await aplicarResultadoTrabajo({
      prisma: db,
      trabajo,
      resultado: parsed.data,
    });
    await registrarLatido({ prisma: db, ...identidadWorker(request), ahora: new Date(), tipo: "trabajo" });
    return ok(resolucion);
  } catch (error) {
    return errorResponse(error);
  }
}

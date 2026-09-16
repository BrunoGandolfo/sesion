import { db } from "@/lib/db";
import { exportarRecorrido } from "@/app/api/_lib/casos-uso/hilo/exportar";
import { autorizarEdicionHilo, responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// POST y no GET: exportar deja un registro en auditoría, y un GET lo podría
// disparar un enlace de otro sitio o un prefetch. /hilo está fuera del proxy,
// así que el control de origen lo hace autorizarEdicionHilo.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, userId } = await autorizarEdicionHilo(request);
    const { id } = await params;
    return responderHilo(await exportarRecorrido(db, { pacienteId: id, organizationId }, userId));
  } catch (error) { return errorResponse(error); }
}

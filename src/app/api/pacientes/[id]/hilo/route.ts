import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { leerHiloParaWorker, leerRecorrido } from "@/app/api/_lib/casos-uso/hilo/leer";
import { responderHilo } from "@/app/api/_lib/hilo-http";
import { ApiError, errorResponse } from "@/app/api/_lib/responses";
import { autorizarTicketSesion } from "@/app/api/_lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const consulta = new URL(request.url).searchParams;
    if (consulta.get("format") === "llm") {
      const sesionId = consulta.get("sesionId");
      if (!sesionId) throw new ApiError("Falta la sesión reclamada", 400);
      const sesion = await autorizarTicketSesion(request, db, sesionId);
      return responderHilo(await leerHiloParaWorker(db, id, sesion));
    }
    if (consulta.has("format")) throw new ApiError("Formato no admitido", 400);
    const { organizationId } = await getSessionActor();
    return responderHilo(await leerRecorrido(db, { pacienteId: id, organizationId }));
  } catch (error) { return errorResponse(error); }
}

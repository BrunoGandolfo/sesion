import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { leerBrief } from "@/app/api/_lib/casos-uso/hilo/brief";
import { responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await getSessionActor();
    const { id: pacienteId } = await params;
    return responderHilo(await leerBrief(db, { pacienteId, organizationId }));
  } catch (e) { return errorResponse(e); }
}

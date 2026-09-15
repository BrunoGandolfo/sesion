import { db } from "@/lib/db";
import { getOrganizationId } from "../../../_lib/auth";
import { parseRangoProgreso } from "../../../_lib/casos-uso/progreso-clinico";
import { leerProgreso } from "../../../_lib/casos-uso/hilo/progreso";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const organizationId = await getOrganizationId();
    const { id: pacienteId } = await params;
    const rango = parseRangoProgreso(new URL(request.url).searchParams.get("rango"));
    return ok(await leerProgreso(db, { pacienteId, organizationId }, rango));
  } catch (error) { return errorResponse(error); }
}

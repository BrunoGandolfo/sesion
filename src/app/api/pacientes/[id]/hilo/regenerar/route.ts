import { db } from "@/lib/db";
import { regenerarHilo } from "@/app/api/_lib/casos-uso/hilo/regenerar";
import { regenerarHiloSchema } from "@/app/api/_lib/schemas";
import { autorizarEdicionHilo, responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, userId } = await autorizarEdicionHilo(request);
    const { id: pacienteId } = await params;
    const datos = regenerarHiloSchema.parse(await request.json());
    return responderHilo(await regenerarHilo({ prisma: db, pacienteId, organizationId, usuarioId: userId, ...datos }));
  } catch (e) { return errorResponse(e); }
}

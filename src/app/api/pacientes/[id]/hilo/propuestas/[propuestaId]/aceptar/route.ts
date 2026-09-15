import { db } from "@/lib/db";
import { aceptarHiloSchema } from "@/app/api/_lib/schemas";
import { aceptarPropuesta } from "@/app/api/_lib/casos-uso/hilo/escribir";
import { autorizarEdicionHilo, responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; propuestaId: string }> }) {
  try {
    const { id, propuestaId } = await params;
    const { organizationId, userId } = await autorizarEdicionHilo(request);
    const datos = aceptarHiloSchema.parse(await request.json());
    return responderHilo(await aceptarPropuesta({ prisma: db, pacienteId: id, organizationId, usuarioId: userId, propuestaId, ...datos }));
  } catch (error) { return errorResponse(error); }
}

import { z } from "zod";
import { db } from "@/lib/db";
import { editarHiloSchema } from "@/app/api/_lib/schemas";
import { getSessionActor } from "@/app/api/_lib/auth";
import { editarHilo } from "@/app/api/_lib/casos-uso/hilo/escribir";
import { historialHilo } from "@/app/api/_lib/casos-uso/hilo/leer";
import { autorizarEdicionHilo, responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
type Contexto = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Contexto) {
  try {
    const { id } = await params;
    const { organizationId } = await getSessionActor();
    const crudo = new URL(request.url).searchParams.get("antes");
    const antes = crudo === null ? undefined : z.coerce.number().int().positive().parse(crudo);
    return responderHilo(await historialHilo(db, { pacienteId: id, organizationId }, antes));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Contexto) {
  try {
    const { id } = await params;
    const { organizationId, userId } = await autorizarEdicionHilo(request);
    const datos = editarHiloSchema.parse(await request.json());
    return responderHilo(await editarHilo({ prisma: db, pacienteId: id, organizationId, usuarioId: userId, ...datos }));
  } catch (error) { return errorResponse(error); }
}

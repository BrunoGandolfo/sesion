import { db } from "@/lib/db";
import { getSessionActor } from "../_lib/auth";
import { ApiError, errorResponse, leerJson, ok } from "../_lib/responses";
import { sesionClinicaCrearSchema } from "../_lib/schemas";
import { leerSesionPorTurno, prepararAudio } from "../_lib/casos-uso/audio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const { organizationId } = await getSessionActor();
    const turnoId = new URL(request.url).searchParams.get("turnoId");
    if (!turnoId) throw new ApiError("Falta turnoId", 400);
    return ok(await leerSesionPorTurno({ prisma: db, organizationId, turnoId }));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { turnoId, iniciadaEn } = sesionClinicaCrearSchema.parse(await leerJson(request));
    await prepararAudio({
      prisma: db, organizationId, turnoId, usuarioId: userId,
      ...(iniciadaEn ? { iniciadaEn: new Date(iniciadaEn) } : {}),
    });
    return ok(await leerSesionPorTurno({ prisma: db, organizationId, turnoId }), 201);
  } catch (error) { return errorResponse(error); }
}

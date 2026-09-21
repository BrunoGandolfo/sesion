import { db } from "@/lib/db";
import { registrarAuditoria } from "../_lib/auditoria";
import { getSessionActor } from "../_lib/auth";
import { ApiError, errorResponse, ok } from "../_lib/responses";
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
    const { turnoId } = sesionClinicaCrearSchema.parse(await request.json());
    const { id } = await prepararAudio({ prisma: db, organizationId, turnoId });
    await registrarAuditoria(db, { organizationId, actorTipo: "usuario", actorId: userId, accion: "sesion.crear", entidad: "sesion_clinica", entidadId: id, detalle: { turnoId } });
    return ok(await leerSesionPorTurno({ prisma: db, organizationId, turnoId }), 201);
  } catch (error) { return errorResponse(error); }
}

import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { errorResponse, ok } from "@/app/api/_lib/responses";
import { prepararAudio } from "@/app/api/_lib/casos-uso/audio";
import { registrarAuditoria } from "@/app/api/_lib/auditoria";
import { prepararAudioSchema } from "@/app/api/_lib/audio-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();

    const body = prepararAudioSchema.parse(await request.json());
    const result = await prepararAudio({ prisma: db, organizationId, ...body });
    await registrarAuditoria({ organizationId, actorTipo: "usuario", actorId: userId, accion: "sesion.crear", entidad: "sesion_clinica", entidadId: result.id, detalle: { turnoId: body.turnoId } });
    const response = ok(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}

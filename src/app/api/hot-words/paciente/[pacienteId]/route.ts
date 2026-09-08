import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import { terminosAsr } from "../../../_lib/casos-uso/terminos-asr";
import { ApiError, errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ pacienteId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { pacienteId } = await params;

    const paciente = await db.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { id: true },
    });

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    // La misma consulta que viaja al worker en cada sesión reclamada
    // (_lib/casos-uso/terminos-asr.ts).
    const terminos = await terminosAsr({
      prisma: db,
      organizationId,
      pacienteId,
    });

    return ok(terminos);
  } catch (error) {
    return errorResponse(error);
  }
}

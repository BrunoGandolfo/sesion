import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
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

    const hotWords = await db.hotWord.findMany({
      where: {
        organizationId,
        activo: true,
        OR: [
          { scope: "global" },
          { scope: "profesional" },
          { scope: "paciente", pacienteId },
        ],
      },
      select: { termino: true },
    });

    const terminos = Array.from(
      new Set(hotWords.map((h) => h.termino)),
    ).sort();

    return ok(terminos);
  } catch (error) {
    return errorResponse(error);
  }
}

import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { actualizarTurno } from "../../_lib/casos-uso/turnos";
import { turnoUpdateSchema } from "../../_lib/schemas";
import { errorResponse, ok, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Las reglas (lock de agenda, solapamiento, qué se puede editar en cada
// estado, recordatorios) viven en casos-uso/turnos.ts. Acá solo se valida el
// body y se responde.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = turnoUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const turno = await actualizarTurno({
      prisma: db,
      organizationId,
      turnoId: id,
      cambios: {
        fecha:
          parsed.data.fecha === undefined
            ? undefined
            : new Date(parsed.data.fecha),
        duracion: parsed.data.duracion,
        modalidad: parsed.data.modalidad,
        notas: parsed.data.notas,
        estado: parsed.data.estado,
      },
      ahora: new Date(),
    });

    return ok(turno);
  } catch (error) {
    return errorResponse(error);
  }
}

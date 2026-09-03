import { db } from "@/lib/db";
import type { Paciente } from "@/types/domain";

import { getOrganizationId } from "../../_lib/auth";
import { toPacienteConDeuda, toTurno } from "../../_lib/domain";
import { requirePaciente } from "../../_lib/pacientes";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
import { pacienteUpdateSchema } from "../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      include: {
        turnos: {
          orderBy: { fecha: "desc" },
        },
      },
    });

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    return Response.json({
      data: toPacienteConDeuda(paciente),
      turnos: paciente.turnos.map(toTurno),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = pacienteUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await requirePaciente(db, id, organizationId);

    // Los campos ausentes quedan undefined y Prisma no los toca; telefono, si
    // vino, ya está normalizado a E.164 por el esquema.
    const paciente = await db.paciente.update({
      where: { id },
      data: parsed.data,
    });

    return ok<Paciente>(paciente);
  } catch (error) {
    return errorResponse(error);
  }
}

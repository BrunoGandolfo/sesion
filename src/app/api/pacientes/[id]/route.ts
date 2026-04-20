import { z } from "zod";
import { db } from "@/lib/db";
import type { Paciente } from "@/types/domain";

import { getOrganizationId } from "../../_lib/auth";
import { toPacienteConDeuda, toTurno } from "../../_lib/domain";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const optionalEmailSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().email().nullable().optional(),
);

const updatePacienteSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre").optional(),
  apellido: z.string().trim().min(1, "Falta el apellido").optional(),
  telefono: z.string().trim().min(1, "Falta el teléfono").optional(),
  email: optionalEmailSchema,
  tarifa: z.number().int().min(0, "La tarifa no puede ser negativa").optional(),
  notas: z.string().trim().nullable().optional(),
  activo: z.boolean().optional(),
});

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
    const parsed = updatePacienteSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.paciente.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const paciente = await db.paciente.update({
      where: { id },
      data: {
        ...parsed.data,
        email: parsed.data.email === undefined ? undefined : parsed.data.email,
        notas: parsed.data.notas === undefined ? undefined : parsed.data.notas,
      },
    });

    return ok<Paciente>(paciente);
  } catch (error) {
    return errorResponse(error);
  }
}

import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import {
  duracionSchema,
  isoDateTimeSchema,
  modalidadSchema,
  turnoEstadoSchema,
} from "../../_lib/schemas";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
import { toTurno } from "../../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const updateTurnoSchema = z.object({
  fecha: isoDateTimeSchema.optional(),
  duracion: duracionSchema.optional(),
  modalidad: modalidadSchema.optional(),
  notas: z.string().trim().nullable().optional(),
  estado: turnoEstadoSchema.optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTurnoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.turno.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new ApiError("Turno no encontrado", 404);
    }

    if (existing.estado === "cancelado" && parsed.data.estado !== undefined) {
      throw new ApiError("No se puede reabrir un turno cancelado", 400);
    }

    const changesDetails =
      parsed.data.fecha !== undefined ||
      parsed.data.duracion !== undefined ||
      parsed.data.modalidad !== undefined ||
      parsed.data.notas !== undefined;

    if (changesDetails && existing.estado !== "programado") {
      throw new ApiError(
        "Solo se pueden editar datos de turnos programados",
        400,
      );
    }

    const data = {
      fecha:
        parsed.data.fecha === undefined
          ? undefined
          : new Date(parsed.data.fecha),
      duracion: parsed.data.duracion,
      modalidad: parsed.data.modalidad,
      notas: parsed.data.notas,
      estado: parsed.data.estado,
    };

    const turno =
      parsed.data.estado === "cancelado"
        ? await db.$transaction(async (tx) => {
            const updated = await tx.turno.update({
              where: { id },
              data,
            });

            await tx.recordatorio.updateMany({
              where: { turnoId: id, estado: "pendiente" },
              data: { estado: "cancelado" },
            });

            return updated;
          })
        : await db.turno.update({
            where: { id },
            data,
          });

    return ok(toTurno(turno));
  } catch (error) {
    return errorResponse(error);
  }
}

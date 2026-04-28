import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  turnoId: z.string().cuid("Turno inválido"),
});

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.$transaction(async (tx) => {
      const turno = await tx.turno.findFirst({
        where: { id: parsed.data.turnoId, organizationId },
        select: { id: true, estado: true, pacienteId: true },
      });

      if (!turno) {
        throw new ApiError("Turno no encontrado", 404);
      }

      if (turno.estado !== "realizado") {
        throw new ApiError(
          "Solo se puede grabar la nota de un turno realizado",
          400,
        );
      }

      const existente = await tx.sesionClinica.findUnique({
        where: { turnoId: turno.id },
        select: { id: true },
      });

      if (existente) {
        throw new ApiError("El turno ya tiene una sesión clínica", 409);
      }

      const consentimiento = await tx.consentimientoGrabacion.findFirst({
        where: { pacienteId: turno.pacienteId, revocadoEn: null },
        select: { id: true },
      });

      if (!consentimiento) {
        throw new ApiError(
          "El paciente no tiene consentimiento de grabación vigente",
          400,
        );
      }

      return tx.sesionClinica.create({
        data: {
          turnoId: turno.id,
          organizationId,
          estado: "pendiente",
        },
      });
    });

    return ok(sesion, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

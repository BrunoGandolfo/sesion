import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import { metodoPagoSchema } from "../../../_lib/schemas";
import { ApiError, errorResponse, ok, validationError } from "../../../_lib/responses";
import { toTurno } from "../../../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const cobrarSchema = z.object({
  metodo: metodoPagoSchema,
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = cobrarSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.turno.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new ApiError("Turno no encontrado", 404);
    }

    if (existing.estado !== "realizado" || existing.pagoEstado !== "pendiente") {
      throw new ApiError("El turno no está pendiente de cobro", 400);
    }

    const turno = await db.turno.update({
      where: { id },
      data: {
        pagoEstado: "pagado",
        pagoFecha: new Date(),
        pagoMetodo: parsed.data.metodo,
      },
    });

    return ok(toTurno(turno));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const existing = await db.turno.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new ApiError("Turno no encontrado", 404);
    }

    if (existing.pagoEstado !== "pagado") {
      throw new ApiError("El turno no está cobrado", 400);
    }

    const turno = await db.turno.update({
      where: { id },
      data: {
        pagoEstado: "pendiente",
        pagoFecha: null,
        pagoMetodo: null,
      },
    });

    return ok(toTurno(turno));
  } catch (error) {
    return errorResponse(error);
  }
}

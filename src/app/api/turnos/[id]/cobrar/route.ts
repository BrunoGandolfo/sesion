import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import { metodoPagoSchema } from "../../../_lib/schemas";
import { cobrarTurno, descobrarTurno } from "../../../_lib/casos-uso/cobrar-turno";
import { errorResponse, ok, validationError } from "../../../_lib/responses";

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

    const turno = await cobrarTurno({
      prisma: db,
      turnoId: id,
      organizationId,
      metodo: parsed.data.metodo,
      fecha: new Date(),
    });

    return ok(turno);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const turno = await descobrarTurno({
      prisma: db,
      turnoId: id,
      organizationId,
    });

    return ok(turno);
  } catch (error) {
    return errorResponse(error);
  }
}

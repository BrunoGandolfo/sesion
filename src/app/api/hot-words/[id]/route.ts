import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const updateSchema = z
  .object({
    activo: z.boolean().optional(),
    categoria: z.string().trim().max(50).nullable().optional(),
  })
  .refine((v) => v.activo !== undefined || v.categoria !== undefined, {
    message: "Nada para actualizar",
  });

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // La organización va en el WHERE de la escritura, no en un chequeo
    // previo: `update({ where: { id } })` escribe la fila aunque sea de otra
    // organización. Mismo patrón que los PATCH de paciente, turno y sesión.
    const { count } = await db.hotWord.updateMany({
      where: { id, organizationId },
      data: {
        activo: parsed.data.activo,
        categoria: parsed.data.categoria,
      },
    });

    if (count === 0) {
      throw new ApiError("Hot word no encontrado", 404);
    }

    const hotWord = await db.hotWord.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        termino: true,
        scope: true,
        categoria: true,
        activo: true,
      },
    });

    return ok(hotWord);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const { count } = await db.hotWord.deleteMany({
      where: { id, organizationId },
    });

    if (count === 0) {
      throw new ApiError("Hot word no encontrado", 404);
    }

    return ok({ id });
  } catch (error) {
    return errorResponse(error);
  }
}

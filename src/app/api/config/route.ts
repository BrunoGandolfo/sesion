import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { toConfiguracion } from "../_lib/domain";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateConfigSchema = z.object({
  nombreProfesional: z.string().trim().min(1, "Falta el nombre").optional(),
  direccion: z.string().trim().optional(),
  whatsappOrigen: z.string().trim().optional(),
  tarifaDefault: z
    .number()
    .int()
    .min(0, "La tarifa no puede ser negativa")
    .optional(),
  horasAnticipacion: z
    .number()
    .int()
    .min(1, "La anticipación mínima es 1 hora")
    .optional(),
  templateRecordatorio: z
    .string()
    .trim()
    .min(1, "Falta el template")
    .optional(),
});

export async function GET() {
  try {
    const organizationId = await getOrganizationId();

    const configuracion = await db.configuracion.findUnique({
      where: { organizationId },
    });

    if (!configuracion) {
      throw new ApiError("Configuración no encontrada", 404);
    }

    return ok(toConfiguracion(configuracion));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = updateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.configuracion.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new ApiError("Configuración no encontrada", 404);
    }

    const configuracion = await db.configuracion.update({
      where: { organizationId },
      data: parsed.data,
    });

    return ok(toConfiguracion(configuracion));
  } catch (error) {
    return errorResponse(error);
  }
}

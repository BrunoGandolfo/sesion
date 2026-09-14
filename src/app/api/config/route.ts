import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import {
  actualizarConfiguracion,
  obtenerConfiguracion,
} from "../_lib/casos-uso/configuracion";
import { errorResponse, ok, validationError } from "../_lib/responses";
import { configUpdateSchema } from "../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const configuracion = await obtenerConfiguracion({ prisma: db, organizationId });

    return ok(configuracion);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = configUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const configuracion = await actualizarConfiguracion({
      prisma: db,
      organizationId,
      cambios: parsed.data,
    });

    return ok(configuracion);
  } catch (error) {
    return errorResponse(error);
  }
}

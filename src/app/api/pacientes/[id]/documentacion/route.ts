// GET /api/pacientes/[id]/documentacion — el historial clínico de la ficha.
// Cuenta como exportación: la lectura y su rastro van juntos
// (casos-uso/sesion/documentacion.ts).

import { z } from "zod";
import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { exportarDocumentacion } from "../../../_lib/casos-uso/sesion/documentacion";
import { errorResponse, ok, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Sólo página y tamaño. Hubo filtros `desde`, `hasta` e `incluirFallidas`
 * que ninguna pantalla mandaba; se sacaron por decisión del dueño (D4,
 * 29-09-2026). Un parámetro que no está acá se ignora.
 */
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError(parsedQuery.error);
    }

    return ok(
      await exportarDocumentacion({
        prisma: db,
        organizationId,
        pacienteId: id,
        usuarioId: userId,
        ...parsedQuery.data,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

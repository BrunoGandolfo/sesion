import { z } from "zod";
import { db } from "@/lib/db";
import { notaSoapSchema } from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { aprobarSesion } from "../../../_lib/casos-uso/sesion/aprobar";
import { errorResponse, ok, validationError } from "../../../_lib/responses";
import { toSesionClinicaResponse } from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

const aprobarSchema = z.object({
  generacion: z.number().int().positive(),
  notaEditada: notaSoapSchema.optional(),
  notasEdicion: z.string().max(5000).optional(),
  /** Riesgo graduado moderado/alto: la profesional declara que lo vio. */
  confirmoRiesgo: z.boolean().optional(),
  /** Menciones léxicas sin riesgo graduado: "Leí las menciones". */
  confirmoMenciones: z.boolean().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const parsed = aprobarSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const sesion = await aprobarSesion({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
      ...parsed.data,
      registrarAuditoria,
    });
    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

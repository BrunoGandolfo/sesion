import { z } from "zod";
import { db } from "@/lib/db";
import { notaSoapSchema } from "@/lib/sesion-clinica/schema";

import { borrarAudioBestEffort } from "../../../_lib/audio";
import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { aprobarSesion } from "../../../_lib/casos-uso/aprobar-sesion";
import { errorResponse, ok, validationError } from "../../../_lib/responses";
import { toSesionClinicaResponse } from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const aprobarSchema = z.object({
  // El cliente (NotaClinicaView) lo manda además de ponerlo en la URL. Se
  // acepta para no rechazar el body, pero la sesión se toma SIEMPRE de la
  // ruta: el valor del body se ignora.
  sesionClinicaId: z.string().optional(),
  notaEditada: notaSoapSchema.optional(),
  notasEdicion: z.string().optional(),
  // Confirmación explícita de que la terapeuta revisó la señal de riesgo
  // graduada (riesgoDetectado nivel alto/moderado). Sin ella no se aprueba.
  confirmoRiesgo: z.boolean().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = aprobarSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await aprobarSesion({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
      notaEditada: parsed.data.notaEditada,
      notasEdicion: parsed.data.notasEdicion,
      confirmoRiesgo: parsed.data.confirmoRiesgo,
      borrarAudio: borrarAudioBestEffort,
      registrarAuditoria,
    });

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

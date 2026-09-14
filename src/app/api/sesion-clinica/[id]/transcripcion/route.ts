// Dos actores, una ruta:
//   GET  — la profesional lee la transcripción (sesión de usuaria; evento de
//          auditoría propio por cada lectura).
//   POST — el worker registra el checkpoint tras el ASR (ticket del reclamo
//          + intento vigente).

import { db } from "@/lib/db";
import { registrarTranscripcionSchema } from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { identidadWorker, registrarLatido } from "../../../_lib/casos-uso/sesion/latido";
import { registrarTranscripcion } from "../../../_lib/casos-uso/sesion/registrar-transcripcion";
import { verTranscripcion } from "../../../_lib/casos-uso/sesion/ver-transcripcion";
import { errorResponse, ok, validationError } from "../../../_lib/responses";
import { autorizarTicketSesion } from "../../../_lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const resultado = await verTranscripcion({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
      registrarAuditoria,
    });
    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const sesion = await autorizarTicketSesion(request, db, id);
    const parsed = registrarTranscripcionSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    await registrarTranscripcion({
      prisma: db,
      sesionId: sesion.sesionId,
      organizationId: sesion.organizationId,
      ...parsed.data,
      registrarAuditoria,
    });
    await registrarLatido({ prisma: db, ...identidadWorker(request), ahora: new Date(), tipo: "trabajo" });
    return ok({ registrada: true });
  } catch (error) {
    return errorResponse(error);
  }
}

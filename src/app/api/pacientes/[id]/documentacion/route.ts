import type { EstadoSesion } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { requirePaciente } from "../../../_lib/pacientes";
import { errorResponse, ok, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

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
    const { page, limit } = parsedQuery.data;

    await requirePaciente(db, id, organizationId);

    const where = {
      organizationId,
      estado: { in: ["revision", "aprobada"] satisfies EstadoSesion[] },
      turno: { pacienteId: id },
    };

    const [totalSesiones, sesiones] = await Promise.all([
      db.sesionClinica.count({ where }),
      db.sesionClinica.findMany({
        where,
        orderBy: { turno: { fecha: "desc" } },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          estado: true,
          duracionAudioSeg: true,
          procesadaEn: true,
          aprobadaEn: true,
          // Campos lógicos de la extensión de cifrado (prisma-encryption.ts).
          notaIa: true,
          notaFinal: true,
          datos: true,
          feedback: true,
          feedbackEstado: true,
          turno: {
            select: {
              id: true,
              fecha: true,
              duracion: true,
              modalidad: true,
            },
          },
        },
      }),
    ]);

    const totalPages =
      totalSesiones === 0 ? 0 : Math.ceil(totalSesiones / limit);

    const payload = sesiones.map((s) => ({
      sesionClinicaId: s.id,
      turnoId: s.turno.id,
      fecha: s.turno.fecha.toISOString(),
      duracionMin: s.turno.duracion,
      duracionAudioSeg: s.duracionAudioSeg,
      modalidad: s.turno.modalidad,
      estado: s.estado,
      // La nota vigente: la aprobada si existe, si no la de la IA.
      nota: s.notaFinal ?? s.notaIa,
      // Parseo del tablero (valida el shape; fila corrupta → null).
      datos: parseDatosEstructurados(s.datos),
      // Su forma la valida quien lo dibuja (hayParaVos).
      feedback: s.feedback,
      feedbackEstado: s.feedbackEstado,
      aprobadaEn: s.aprobadaEn ? s.aprobadaEn.toISOString() : null,
      procesadaEn: s.procesadaEn ? s.procesadaEn.toISOString() : null,
    }));

    // Este GET devuelve notas completas en lote: cuenta como exportación.
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.exportar",
      entidad: "paciente",
      entidadId: id,
      detalle: { page, limit, total: totalSesiones },
    });

    return ok({
      pacienteId: id,
      totalSesiones,
      sesiones: payload,
      page,
      totalPages,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

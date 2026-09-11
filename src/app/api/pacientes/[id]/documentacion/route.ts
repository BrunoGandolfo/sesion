import { z } from "zod";
import { db } from "@/lib/db";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";
import { ensamblarNotaSOAP } from "@/lib/sesion-clinica-utils";

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
      estado: { in: ["revision", "aprobado"] },
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
          procesadoEn: true,
          aprobadoEn: true,
          notaSubjetivo: true,
          notaObjetivo: true,
          notaAnalisis: true,
          notaPlan: true,
          datosEstructurados: true,
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
      nota: ensamblarNotaSOAP({
        subjetivo: s.notaSubjetivo,
        objetivo: s.notaObjetivo,
        analisis: s.notaAnalisis,
        plan: s.notaPlan,
      }),
      // Parseo del tablero (valida el shape; fila corrupta → null).
      datosEstructurados: parseDatosEstructurados(s.datosEstructurados),
      aprobadoEn: s.aprobadoEn ? s.aprobadoEn.toISOString() : null,
      procesadoEn: s.procesadoEn ? s.procesadoEn.toISOString() : null,
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

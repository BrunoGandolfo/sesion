import { z } from "zod";
import { db } from "@/lib/db";
import type { DatosEstructurados, NotaSOAP } from "@/types/domain";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

// La extensión de cifrado descifra `datosEstructuradosEncrypted` a un objeto
// vía JSON.parse, pero el tipo generado por Prisma sigue siendo `string | null`
// (la columna legacy es String?). Aceptamos ambas formas + null para ser
// robustos frente a filas no migradas.
function parseDatosEstructurados(raw: unknown): DatosEstructurados | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DatosEstructurados;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as DatosEstructurados;
  return null;
}

function buildNota(s: {
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
}): NotaSOAP | null {
  if (
    s.notaSubjetivo == null &&
    s.notaObjetivo == null &&
    s.notaAnalisis == null &&
    s.notaPlan == null
  ) {
    return null;
  }
  return {
    subjetivo: s.notaSubjetivo ?? "",
    objetivo: s.notaObjetivo ?? "",
    analisis: s.notaAnalisis ?? "",
    plan: s.notaPlan ?? "",
  };
}

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

    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

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
      nota: buildNota(s),
      datosEstructurados: parseDatosEstructurados(
        s.datosEstructurados as unknown,
      ),
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

import type { EstadoSesion } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";

import { auditar } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { requirePaciente } from "../../../_lib/pacientes";
import { bordeMvd } from "../../../_lib/periodo";
import { errorResponse, ok, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Los estados que este historial muestra.
 *
 * Por defecto, lo que la profesional dio por bueno o está por darlo. Con
 * `incluirFallidas=1` entran también las que se procesaron y fallaron: son
 * sesiones que ocurrieron y cuya nota falta, y hasta ahora no se podían
 * mirar desde la ficha de la paciente.
 */
const ESTADOS_BASE: EstadoSesion[] = ["revision", "aprobada"];
const CON_FALLIDAS: EstadoSesion[] = [...ESTADOS_BASE, "fallida"];

/**
 * Sin parámetros nuevos, la respuesta es EXACTAMENTE la de antes: página 1,
 * diez por página, sin filtro de fechas y sin fallidas.
 *
 * `desde` y `hasta` aceptan un mes ("2026-09") o un día ("2026-09-30") y se
 * resuelven en hora de Montevideo: `desde` toma el principio del período y
 * `hasta` el final, así "desde=2026-09&hasta=2026-09" es el mes entero y una
 * sesión del 30 a las 23:30 entra. Filtran por la fecha del TURNO, que es la
 * que ordena la lista y la que la profesional tiene en la cabeza.
 */
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  incluirFallidas: z.enum(["0", "1"]).optional(),
});

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      desde: url.searchParams.get("desde") ?? undefined,
      hasta: url.searchParams.get("hasta") ?? undefined,
      incluirFallidas: url.searchParams.get("incluirFallidas") ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError(parsedQuery.error);
    }
    const { page, limit, desde, hasta, incluirFallidas } = parsedQuery.data;

    await requirePaciente(db, id, organizationId);

    const conFallidas = incluirFallidas === "1";
    const rango = {
      ...(desde ? { gte: bordeMvd(desde, "desde") } : {}),
      ...(hasta ? { lte: bordeMvd(hasta, "hasta") } : {}),
    };

    const where = {
      organizationId,
      estado: { in: conFallidas ? CON_FALLIDAS : ESTADOS_BASE },
      turno: {
        pacienteId: id,
        ...(desde || hasta ? { fecha: rango } : {}),
      },
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

    // Este GET devuelve notas completas en lote: cuenta como EXPORTACIÓN de
    // documentación clínica, y por eso va con `auditar` y no con la variante
    // best-effort: si el rastro no se puede escribir, las notas no salen (la
    // usuaria ve un error y vuelve a pedirlas). Es el mismo criterio que
    // casos-uso/hilo/exportar.ts. No hay transacción que abrazarlo porque el
    // acto es una lectura: alcanza con escribirlo ANTES de devolver el
    // cuerpo, y que su fallo voltee la respuesta.
    await auditar(db, {
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.exportar",
      entidad: "paciente",
      entidadId: id,
      // Los filtros entran al rastro: exportar tres meses y exportar todo no
      // son el mismo acto, y el registro tiene que poder distinguirlos.
      detalle: {
        page,
        limit,
        total: totalSesiones,
        ...(desde ? { desde } : {}),
        ...(hasta ? { hasta } : {}),
        ...(conFallidas ? { incluirFallidas: true } : {}),
      },
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

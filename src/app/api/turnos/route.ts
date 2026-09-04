import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  calcularProgramadoEn,
  normalizarRecordatorioModo,
} from "@/lib/recordatorios-programacion";

import { getOrganizationId } from "../_lib/auth";
import {
  duracionSchema,
  isoDateTimeSchema,
  modalidadSchema,
  toBooleanParam,
} from "../_lib/schemas";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";
import { toRecordatorio, toTurno, toTurnoConPaciente } from "../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  desde: isoDateTimeSchema,
  hasta: isoDateTimeSchema,
  pacienteId: z.string().optional(),
  includeCancelados: z.boolean(),
});

const createTurnoSchema = z.object({
  pacienteId: z.string().cuid("Paciente inválido"),
  fecha: isoDateTimeSchema,
  duracion: duracionSchema,
  modalidad: modalidadSchema,
  notas: z.string().trim().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      desde: url.searchParams.get("desde") ?? "",
      hasta: url.searchParams.get("hasta") ?? "",
      pacienteId: url.searchParams.get("pacienteId") ?? undefined,
      includeCancelados: toBooleanParam(
        url.searchParams.get("includeCancelados"),
        false,
      ),
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const where: Prisma.TurnoWhereInput = {
      organizationId,
      fecha: {
        gte: new Date(parsed.data.desde),
        lte: new Date(parsed.data.hasta),
      },
    };

    if (parsed.data.pacienteId) {
      where.pacienteId = parsed.data.pacienteId;
    }

    if (!parsed.data.includeCancelados) {
      where.estado = { not: "cancelado" };
    }

    const turnos = await db.turno.findMany({
      where,
      include: {
        paciente: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
          },
        },
      },
      orderBy: { fecha: "asc" },
    });

    return ok(turnos.map(toTurnoConPaciente));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = createTurnoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const result = await db.$transaction(async (tx) => {
      const paciente = await tx.paciente.findFirst({
        where: { id: parsed.data.pacienteId, organizationId },
        select: { id: true, tarifa: true },
      });

      if (!paciente) {
        throw new ApiError("Paciente no encontrado", 404);
      }

      const configuracion = await tx.configuracion.findUnique({
        where: { organizationId },
        select: { recordatorioModo: true },
      });

      const fecha = new Date(parsed.data.fecha);
      const programadoEn = calcularProgramadoEn(
        fecha,
        normalizarRecordatorioModo(configuracion?.recordatorioModo),
      );

      const turno = await tx.turno.create({
        data: {
          pacienteId: paciente.id,
          organizationId,
          fecha,
          duracion: parsed.data.duracion,
          modalidad: parsed.data.modalidad,
          estado: "programado",
          tarifaCobrada: paciente.tarifa,
          pagoEstado: "pendiente",
          notas: parsed.data.notas ?? null,
        },
      });

      const recordatorio = await tx.recordatorio.create({
        data: {
          turnoId: turno.id,
          programadoEn,
          estado: "pendiente",
        },
      });

      return { turno, recordatorio };
    });

    return Response.json(
      {
        data: toTurno(result.turno),
        recordatorio: toRecordatorio(result.recordatorio),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

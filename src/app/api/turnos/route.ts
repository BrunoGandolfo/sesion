import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { programarRecordatorio } from "../_lib/casos-uso/recordatorios-del-turno";
import { assertSinSolapamiento } from "../_lib/casos-uso/solapamiento-turnos";
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

    const ahora = new Date();

    const result = await db.$transaction(async (tx) => {
      const paciente = await tx.paciente.findFirst({
        where: { id: parsed.data.pacienteId, organizationId },
        select: { id: true, tarifa: true },
      });

      if (!paciente) {
        throw new ApiError("Paciente no encontrado", 404);
      }

      const fecha = new Date(parsed.data.fecha);

      // Dentro de la transacción y con la fila del paciente ya leída: dos
      // altas en paralelo para el mismo horario no pueden pasar las dos la
      // comprobación y crear las dos el turno.
      await assertSinSolapamiento({
        prisma: tx,
        organizationId,
        intervalo: { inicio: fecha, duracionMin: parsed.data.duracion },
      });

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

      // Un turno con fecha pasada no lleva recordatorio: es el caso de
      // /grabar/nuevo, que crea el turno con la hora de este instante porque
      // la sesión está empezando. Sin esta guarda se creaba igual, con
      // `programadoEn` calculado hacia atrás (las 20:00 de ayer), y el cron
      // le mandaba a la paciente un SMS recordándole la sesión que estaba
      // teniendo en ese momento. La regla vive en
      // casos-uso/recordatorios-del-turno.ts.
      const recordatorio = await programarRecordatorio({
        prisma: tx,
        turnoId: turno.id,
        organizationId,
        fechaTurno: fecha,
        ahora,
      });

      return { turno, recordatorio };
    });

    return Response.json(
      {
        data: toTurno(result.turno),
        // null cuando el turno ya había empezado. Nadie lo lee hoy (los
        // formularios usan sólo `data`), pero el campo no se saca: es la
        // forma de la respuesta desde que existe la ruta.
        recordatorio: result.recordatorio
          ? toRecordatorio(result.recordatorio)
          : null,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

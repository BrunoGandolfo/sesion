import { z } from "zod";
import { db } from "@/lib/db";
import {
  calcularProgramadoEn,
  normalizarRecordatorioModo,
} from "@/lib/recordatorios-programacion";

import { getOrganizationId } from "../../_lib/auth";
import {
  duracionSchema,
  isoDateTimeSchema,
  modalidadSchema,
  turnoEstadoSchema,
} from "../../_lib/schemas";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
import { toTurno } from "../../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const updateTurnoSchema = z.object({
  fecha: isoDateTimeSchema.optional(),
  duracion: duracionSchema.optional(),
  modalidad: modalidadSchema.optional(),
  notas: z.string().trim().nullable().optional(),
  estado: turnoEstadoSchema.optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTurnoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.turno.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new ApiError("Turno no encontrado", 404);
    }

    if (existing.estado === "cancelado" && parsed.data.estado !== undefined) {
      throw new ApiError("No se puede reabrir un turno cancelado", 400);
    }

    const changesDetails =
      parsed.data.fecha !== undefined ||
      parsed.data.duracion !== undefined ||
      parsed.data.modalidad !== undefined ||
      parsed.data.notas !== undefined;

    if (changesDetails && existing.estado !== "programado") {
      throw new ApiError(
        "Solo se pueden editar datos de turnos programados",
        400,
      );
    }

    const data = {
      fecha:
        parsed.data.fecha === undefined
          ? undefined
          : new Date(parsed.data.fecha),
      duracion: parsed.data.duracion,
      modalidad: parsed.data.modalidad,
      notas: parsed.data.notas,
      estado: parsed.data.estado,
    };

    const turno = await db.$transaction(async (tx) => {
      // La organización va en el WHERE de la escritura y no sólo en el
      // findFirst de arriba: `update({ where: { id } })` escribe la fila
      // aunque sea de otra organización, y entre la lectura y la escritura
      // hay una ventana. Con updateMany + count la pertenencia es parte de la
      // operación.
      const { count } = await tx.turno.updateMany({
        where: { id, organizationId },
        data,
      });

      if (count === 0) {
        throw new ApiError("Turno no encontrado", 404);
      }

      const updated = await tx.turno.findUniqueOrThrow({ where: { id } });

      if (updated.estado === "cancelado") {
        await tx.recordatorio.updateMany({
          where: { turnoId: id, estado: "pendiente" },
          data: { estado: "cancelado" },
        });

        return updated;
      }

      // Si la fecha no cambió, no se reprograma ningún recordatorio.
      const fechaCambio =
        parsed.data.fecha !== undefined &&
        updated.fecha.getTime() !== existing.fecha.getTime();

      if (!fechaCambio) {
        return updated;
      }

      await tx.recordatorio.updateMany({
        where: { turnoId: id, estado: "pendiente" },
        data: { estado: "cancelado" },
      });

      const configuracion = await tx.configuracion.findUnique({
        where: { organizationId },
        select: { recordatorioModo: true },
      });

      const programadoEn = calcularProgramadoEn(
        updated.fecha,
        normalizarRecordatorioModo(configuracion?.recordatorioModo),
      );

      // La reprogramación genera un recordatorio nuevo alineado a la nueva fecha.
      await tx.recordatorio.create({
        data: {
          turnoId: updated.id,
          programadoEn,
          estado: "pendiente",
        },
      });

      return updated;
    });

    return ok(toTurno(turno));
  } catch (error) {
    return errorResponse(error);
  }
}

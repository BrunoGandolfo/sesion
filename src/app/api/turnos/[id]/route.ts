import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import {
  cerrarRecordatoriosDelTurno,
  programarRecordatorio,
  turnoSigueProgramado,
} from "../../_lib/casos-uso/recordatorios-del-turno";
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
    const ahora = new Date();
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

      // Un turno que dejó de estar programado —realizado, ausente o
      // cancelado— no avisa nada. Antes esto sólo pasaba al cancelar; marcar
      // "realizado" (lo hace la pantalla de grabar al terminar la sesión) o
      // "ausente" dejaba el recordatorio vivo. La regla vive en
      // casos-uso/recordatorios-del-turno.ts, no acá.
      if (!turnoSigueProgramado(updated.estado)) {
        await cerrarRecordatoriosDelTurno(tx, id);

        return updated;
      }

      // Si la fecha no cambió, no se reprograma ningún recordatorio.
      const fechaCambio =
        parsed.data.fecha !== undefined &&
        updated.fecha.getTime() !== existing.fecha.getTime();

      if (!fechaCambio) {
        return updated;
      }

      // Reprogramación: se apaga lo viejo y se programa lo nuevo. Si la
      // fecha nueva ya pasó, programarRecordatorio no crea nada.
      await cerrarRecordatoriosDelTurno(tx, id);
      await programarRecordatorio({
        prisma: tx,
        turnoId: updated.id,
        organizationId,
        fechaTurno: updated.fecha,
        ahora,
      });

      return updated;
    });

    return ok(toTurno(turno));
  } catch (error) {
    return errorResponse(error);
  }
}

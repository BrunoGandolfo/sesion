import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import {
  cerrarRecordatoriosDelTurno,
  programarRecordatorio,
  turnoSigueProgramado,
} from "../../_lib/casos-uso/recordatorios-del-turno";
import {
  assertSinSolapamiento,
  ESTADOS_QUE_OCUPAN,
} from "../../_lib/casos-uso/solapamiento-turnos";
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

    // El intervalo en el que va a quedar el turno después de este PATCH: lo
    // que se manda, o lo que ya tenía.
    const fechaFinal = data.fecha ?? existing.fecha;
    const duracionFinal = data.duracion ?? existing.duracion;
    const estadoFinal = data.estado ?? existing.estado;

    // Sólo se comprueba el solapamiento cuando este PATCH puede CREARLO. Dos
    // formas, y ninguna más:
    //
    //   - se movió el intervalo (fecha o duración) de un turno que ocupa;
    //   - el turno pasó de no ocupar a ocupar (ausente → programado; ver la
    //     rama `reabierto` de más abajo).
    //
    // Lo que no se hace es revalidar en cada edición: un turno que ya estaba
    // solapado —de antes de esta regla, o porque la ausencia se deshizo— no
    // puede quedar con las notas sin poder editarse para siempre.
    const ocupaAhora = ESTADOS_QUE_OCUPAN.includes(
      estadoFinal as (typeof ESTADOS_QUE_OCUPAN)[number],
    );
    const movioElIntervalo =
      (data.fecha !== undefined &&
        data.fecha.getTime() !== existing.fecha.getTime()) ||
      (data.duracion !== undefined && data.duracion !== existing.duracion);
    const pasaAOcupar =
      !ESTADOS_QUE_OCUPAN.includes(
        existing.estado as (typeof ESTADOS_QUE_OCUPAN)[number],
      ) && ocupaAhora;

    const turno = await db.$transaction(async (tx) => {
      if (ocupaAhora && (movioElIntervalo || pasaAOcupar)) {
        await assertSinSolapamiento({
          prisma: tx,
          organizationId,
          intervalo: { inicio: fechaFinal, duracionMin: duracionFinal },
          // Sin esto, mover un turno cinco minutos lo haría chocar consigo
          // mismo.
          excluirTurnoId: id,
        });
      }

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

      // Llegados acá el turno ESTÁ programado. Dos motivos para rehacer el
      // recordatorio, y hasta ahora sólo se miraba el primero:
      //
      //   fechaCambio — la reprogramación de siempre.
      //
      //   reabierto — el turno venía cerrado (realizado, ausente o cancelado)
      //     y vuelve a "programado". El PATCH que lo cerró apagó sus
      //     recordatorios, así que la fila quedó sin ninguno; sin esta rama,
      //     un turno reabierto sin tocar la fecha no vuelve a avisar nunca y
      //     la paciente no recibe nada. Es la regresión que dejó el PR #14 al
      //     empezar a cerrar recordatorios en TODOS los cierres: antes el
      //     recordatorio sobrevivía al cierre y reabrir lo dejaba servido.
      //
      // (El PATCH rechaza más arriba reabrir un turno CANCELADO, así que en
      // la práctica `reabierto` es realizado/ausente → programado. La
      // condición no lo asume: pregunta por el estado, no por cuál era.)
      const fechaCambio =
        parsed.data.fecha !== undefined &&
        updated.fecha.getTime() !== existing.fecha.getTime();

      const reabierto =
        !turnoSigueProgramado(existing.estado) &&
        turnoSigueProgramado(updated.estado);

      if (!fechaCambio && !reabierto) {
        return updated;
      }

      // Se apaga lo viejo y se programa lo nuevo. Cerrar es idempotente, así
      // que sirve para los dos casos: en la reprogramación apaga el
      // recordatorio de la fecha vieja, y al reabrir no encuentra nada vivo
      // que apagar. Si la fecha del turno ya pasó, programarRecordatorio no
      // crea nada — reabrir un turno de la semana pasada no manda un SMS
      // sobre una sesión que ya ocurrió.
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

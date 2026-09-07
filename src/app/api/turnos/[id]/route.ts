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
  tomarLockDeAgenda,
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

    const changesDetails =
      parsed.data.fecha !== undefined ||
      parsed.data.duracion !== undefined ||
      parsed.data.modalidad !== undefined ||
      parsed.data.notas !== undefined;

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

    const ocupa = (estado: string) =>
      ESTADOS_QUE_OCUPAN.includes(
        estado as (typeof ESTADOS_QUE_OCUPAN)[number],
      );

    const turno = await db.$transaction(async (tx) => {
      // El lock PRIMERO, y recién después releer el turno (Codex P1 sobre
      // este PR).
      //
      // Componer el intervalo final con la fila que se leyó antes del lock es
      // leer datos viejos: dos PATCH simultáneos sobre el MISMO turno que
      // tocan campos distintos se pisan. El ejemplo que dio Codex: uno mueve
      // un turno de 10:00/50 a las 11:00 y el otro le cambia la duración a
      // 90. El segundo espera el lock, valida 10:00-11:30 (la fecha vieja),
      // pasa, y su update parcial —que no manda `fecha`— conserva las 11:00
      // recién commiteadas: el turno termina en 11:00-12:30, un intervalo que
      // nadie validó y que puede pisar al de las 11:30.
      //
      // Releer adentro del lock hace que el segundo componga sobre el
      // resultado del primero, que es lo que su UPDATE va a producir.
      await tomarLockDeAgenda(tx, organizationId);

      const actual = await tx.turno.findFirst({
        where: { id, organizationId },
      });

      if (!actual) {
        throw new ApiError("Turno no encontrado", 404);
      }

      // Las dos guardas de estado también miran la fila releída: si se
      // decidieran con la lectura previa al lock, un turno cancelado en el
      // medio se podría reabrir igual.
      if (actual.estado === "cancelado" && parsed.data.estado !== undefined) {
        throw new ApiError("No se puede reabrir un turno cancelado", 400);
      }

      if (changesDetails && actual.estado !== "programado") {
        throw new ApiError(
          "Solo se pueden editar datos de turnos programados",
          400,
        );
      }

      // El intervalo en el que va a quedar el turno después de este PATCH: lo
      // que se manda, o lo que tiene AHORA.
      const fechaFinal = data.fecha ?? actual.fecha;
      const duracionFinal = data.duracion ?? actual.duracion;
      const estadoFinal = data.estado ?? actual.estado;

      // Sólo se comprueba el solapamiento cuando este PATCH puede CREARLO.
      // Dos formas, y ninguna más:
      //
      //   - se movió el intervalo (fecha o duración) de un turno que ocupa;
      //   - el turno pasó de no ocupar a ocupar (ausente → programado; ver la
      //     rama `reabierto` de más abajo).
      //
      // Lo que no se hace es revalidar en cada edición: un turno que ya
      // estaba solapado —de antes de esta regla, o porque la ausencia se
      // deshizo— no puede quedar con las notas sin poder editarse para
      // siempre.
      const movioElIntervalo =
        fechaFinal.getTime() !== actual.fecha.getTime() ||
        duracionFinal !== actual.duracion;
      const pasaAOcupar = !ocupa(actual.estado) && ocupa(estadoFinal);

      if (ocupa(estadoFinal) && (movioElIntervalo || pasaAOcupar)) {
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
        updated.fecha.getTime() !== actual.fecha.getTime();

      const reabierto =
        !turnoSigueProgramado(actual.estado) &&
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

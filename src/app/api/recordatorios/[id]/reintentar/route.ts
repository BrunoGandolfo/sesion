// Reintentar un recordatorio que falló.
//
// El cron agota `maxIntentos` y deja la fila en "fallido"; a partir de ahí no
// la vuelve a mirar nunca, y hasta hoy no había forma de pedirle que lo
// intentara otra vez sin entrar a la base. Este endpoint la devuelve a
// "pendiente" con los intentos en cero y la hora en ahora, así el próximo
// tick del cron la toma.
//
// Tres condiciones, y las tres importan:
//   - el recordatorio tiene que estar en "fallido" (no se reintenta lo que
//     ya salió, ni lo que está en curso);
//   - el turno tiene que seguir "programado" (uno cancelado o ausente no
//     necesita aviso);
//   - el turno tiene que ser futuro (avisar de una sesión que ya pasó es
//     peor que no avisar).

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { registrarAuditoria } from "../../../_lib/auditoria";
import { toRecordatorio } from "../../../_lib/domain";
import { ApiError, errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const ahora = new Date();

    const recordatorio = await db.recordatorio.findFirst({
      // El recordatorio no lleva organizationId: se filtra por el del turno.
      where: { id, turno: { organizationId } },
      select: {
        id: true,
        estado: true,
        intentos: true,
        turnoId: true,
        turno: { select: { estado: true, fecha: true } },
      },
    });

    if (!recordatorio) {
      throw new ApiError("Recordatorio no encontrado", 404);
    }

    if (recordatorio.estado !== "fallido") {
      throw new ApiError("Sólo se reintenta un recordatorio fallido", 409);
    }

    if (recordatorio.turno.estado !== "programado") {
      throw new ApiError("El turno ya no está programado", 409);
    }

    if (recordatorio.turno.fecha.getTime() <= ahora.getTime()) {
      throw new ApiError("El turno ya pasó", 409);
    }

    // updateMany condicionado al estado: si otra pestaña reintentó primero,
    // o el cron lo movió entre la lectura y esta escritura, count es 0 y no
    // se pisa nada.
    //
    // Y la organización va en el WHERE de la ESCRITURA, no sólo en el
    // findFirst de arriba: `updateMany({ where: { id } })` revive el
    // recordatorio aunque sea de otra organización, y entre la lectura y la
    // escritura hay una ventana. El recordatorio no tiene columna propia de
    // organización: se filtra por la del turno, igual que la lectura.
    const { count } = await db.recordatorio.updateMany({
      where: { id, estado: "fallido", turno: { organizationId } },
      data: {
        estado: "pendiente",
        intentos: 0,
        error: null,
        programadoEn: ahora,
      },
    });

    if (count === 0) {
      throw new ApiError("Sólo se reintenta un recordatorio fallido", 409);
    }

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "recordatorio.reintentado",
      entidad: "recordatorio",
      entidadId: id,
      detalle: {
        turnoId: recordatorio.turnoId,
        intentosPrevios: recordatorio.intentos,
      },
    });

    const actualizado = await db.recordatorio.findUniqueOrThrow({
      where: { id },
    });

    return ok(toRecordatorio(actualizado));
  } catch (error) {
    return errorResponse(error);
  }
}

// Caso de uso: cancelar el resto de una serie de turnos.
//
// Es la única regla que lee `Turno.serieId`. Cancela ESTE turno y los de la
// misma serie que vienen después (fecha mayor o igual) y siguen programados.
// No toca:
//   - los realizados, ausentes ni ya cancelados (a cualquier fecha);
//   - los programados anteriores a este turno (cancelar "desde acá" no
//     borra la semana pasada);
//   - turnos de otra organización, aunque compartan serieId por error.
// Cada turno cancelado apaga sus avisos por SMS, igual que si se cancelara
// solo (casos-uso/envios-del-turno.ts).
//
// Cancelar UN turno de la serie sigue siendo el PATCH de siempre; esto es
// una acción aparte, no una variante.

import { MENSAJE_SIN_SERIE } from "@/lib/glosario";
import type { db } from "@/lib/db";

import { ApiError } from "../responses";
import { cancelarEnviosDelTurno } from "./envios-del-turno";
import { tomarLockDeAgenda } from "./solapamiento-turnos";

type ClientePrisma = typeof db;


export interface CancelarRestoDeSerieInput {
  prisma: ClientePrisma;
  organizationId: string;
  /** El turno desde el cual se cancela (inclusive). */
  turnoId: string;
}

export interface RestoDeSerieCancelado {
  serieId: string;
  /** Cuántos turnos pasaron a cancelado en esta llamada. */
  cancelados: number;
}

export async function cancelarRestoDeSerie({
  prisma,
  organizationId,
  turnoId,
}: CancelarRestoDeSerieInput): Promise<RestoDeSerieCancelado> {
  return prisma.$transaction(async (tx) => {
    // El lock de agenda PRIMERO, como el PATCH y el alta: así una edición
    // simultánea de uno de estos turnos espera a que esto termine (o al
    // revés) en vez de pisarse. Codex P2 sobre esta rama.
    await tomarLockDeAgenda(tx, organizationId);

    const desde = await tx.turno.findFirst({
      where: { id: turnoId, organizationId },
      select: { id: true, fecha: true, serieId: true },
    });

    if (!desde) {
      throw new ApiError("Turno no encontrado", 404);
    }

    if (desde.serieId === null) {
      throw new ApiError(MENSAJE_SIN_SERIE, 400);
    }

    const candidatos = await tx.turno.findMany({
      where: {
        organizationId,
        serieId: desde.serieId,
        estado: "programado",
        fecha: { gte: desde.fecha },
      },
      select: { id: true },
    });
    const ids = candidatos.map((t) => t.id);

    if (ids.length === 0) {
      return { serieId: desde.serieId, cancelados: 0 };
    }

    // El predicado va también en la escritura: cobrar un turno no toma el
    // lock de agenda (lo cierra con un updateMany atómico), así que uno de
    // los candidatos puede haber pasado a "realizado" entre la lectura y
    // esta línea. Con `estado: "programado"` en el WHERE, ese se queda como
    // está y no cuenta.
    const { count } = await tx.turno.updateMany({
      where: { id: { in: ids }, organizationId, estado: "programado" },
      data: { estado: "cancelado" },
    });

    // Avisos sólo de los que efectivamente se cancelaron. Cancelar es
    // idempotente: si uno lo canceló un PATCH en el medio, ya lo apagó.
    const cancelados = await tx.turno.findMany({
      where: { id: { in: ids }, estado: "cancelado" },
      select: { id: true },
    });
    for (const { id } of cancelados) {
      await cancelarEnviosDelTurno(tx, id);
    }

    return { serieId: desde.serieId, cancelados: count };
  });
}

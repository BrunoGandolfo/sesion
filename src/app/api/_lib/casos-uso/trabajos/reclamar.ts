// Claim de trabajos durables: la misma regla para la app (cron) y el worker.
//
//   UPDATE trabajos SET estado = 'en_curso', intentos = intentos + 1,
//     lease_vence_en = now + LEASE [, ticket_hash = …]
//   WHERE id = ? AND estado IN ('pendiente','en_curso') AND intentos = <leído>
//     AND proximo_intento_en <= now AND (lease_vence_en IS NULL OR < now)
//
// `intentos` en el WHERE es la versión de la fila: si otro consumidor la
// tomó entre el findMany y acá, count = 0 y se omite. Ninguno de los dos
// consumidores ve los trabajos del otro (`ejecutor` en el WHERE).
//
// Para el worker cada trabajo entregado lleva un ticket (credencial para
// informar el resultado). Para la app no: el cron corre en el mismo proceso.

import type { EjecutorTrabajo, Prisma, TipoTrabajo } from "@prisma/client";

import type { db } from "@/lib/db";

import { emitirTicket } from "../../tickets";

import { LEASE_TRABAJO_MS } from "./politica";

type ClienteTrabajos = Pick<typeof db, "trabajo" | "hiloVersion">;

export interface ReclamarTrabajosInput {
  prisma: ClienteTrabajos;
  ejecutor: EjecutorTrabajo;
  ahora: Date;
  limite: number;
  /** Sólo estos tipos (el worker pide los que sabe ejecutar). Vacío = todos. */
  tipos?: ReadonlyArray<TipoTrabajo>;
}

export interface TrabajoReclamado {
  id: string;
  tipo: TipoTrabajo;
  organizationId: string;
  sesionId: string | null;
  pacienteId: string | null;
  payload: Prisma.JsonValue;
  /** Ya incrementado: el intento que acaba de empezar. */
  intentos: number;
  /** Sólo para el worker. */
  ticket: string | null;
}

/**
 * Regla de encadenado de `integrar_contexto` (diseño 04 §2.4): no se entrega
 * si el paciente tiene una propuesta abierta o un trabajo anterior del mismo
 * tipo sin terminar. La segunda propuesta tiene que escribirse sobre el hilo
 * que ya incluye a la primera.
 */
async function bloqueadoPorEncadenado(
  prisma: ClienteTrabajos,
  trabajo: { id: string; pacienteId: string | null; creadoEn: Date },
): Promise<boolean> {
  if (!trabajo.pacienteId) return false;
  const [anterior, propuesta] = await Promise.all([
    prisma.trabajo.count({
      where: {
        tipo: "integrar_contexto",
        pacienteId: trabajo.pacienteId,
        estado: { in: ["pendiente", "en_curso"] },
        id: { not: trabajo.id },
        creadoEn: { lt: trabajo.creadoEn },
      },
    }),
    prisma.hiloVersion.count({
      where: { pacienteId: trabajo.pacienteId, estado: "propuesta" },
    }),
  ]);
  return anterior > 0 || propuesta > 0;
}

export async function reclamarTrabajos({
  prisma,
  ejecutor,
  ahora,
  limite,
  tipos,
}: ReclamarTrabajosInput): Promise<TrabajoReclamado[]> {
  const candidatos = await prisma.trabajo.findMany({
    where: {
      ejecutor,
      estado: { in: ["pendiente", "en_curso"] },
      proximoIntentoEn: { lte: ahora },
      OR: [{ leaseVenceEn: null }, { leaseVenceEn: { lt: ahora } }],
      ...(tipos && tipos.length > 0 ? { tipo: { in: [...tipos] } } : {}),
    },
    orderBy: { creadoEn: "asc" },
    take: limite,
    select: {
      id: true,
      tipo: true,
      organizationId: true,
      sesionId: true,
      pacienteId: true,
      payload: true,
      intentos: true,
      creadoEn: true,
    },
  });

  const lease = new Date(ahora.getTime() + LEASE_TRABAJO_MS[ejecutor]);
  const reclamados: TrabajoReclamado[] = [];

  for (const c of candidatos) {
    if (
      c.tipo === "integrar_contexto" &&
      (await bloqueadoPorEncadenado(prisma, c))
    ) {
      continue;
    }

    const ticket = ejecutor === "worker" ? emitirTicket() : null;
    const { count } = await prisma.trabajo.updateMany({
      where: {
        id: c.id,
        estado: { in: ["pendiente", "en_curso"] },
        intentos: c.intentos,
        proximoIntentoEn: { lte: ahora },
        OR: [{ leaseVenceEn: null }, { leaseVenceEn: { lt: ahora } }],
      },
      data: {
        estado: "en_curso",
        intentos: { increment: 1 },
        leaseVenceEn: lease,
        ticketHash: ticket?.ticketHash ?? null,
      },
    });
    if (count === 0) continue;

    reclamados.push({
      id: c.id,
      tipo: c.tipo,
      organizationId: c.organizationId,
      sesionId: c.sesionId,
      pacienteId: c.pacienteId,
      payload: c.payload,
      intentos: c.intentos + 1,
      ticket: ticket?.ticket ?? null,
    });
  }

  return reclamados;
}

// Resultado de un trabajo que ejecutó el worker: resolver el trabajo (hecho,
// pendiente con backoff, o fallido al tope) y aplicar en la misma
// transacción lo que ese tipo deja en la base.
//
//   generar_feedback → feedback cifrado + feedbackEstado listo, escrito
//                      WHERE feedback_estado = 'pendiente' AND generacion =
//                      la del payload (idempotente, y un trabajo de una
//                      generación anterior no pisa la nueva: reprocesar crea
//                      otro trabajo para la nota siguiente); al tope de
//                      reintentos, feedbackEstado fallido con el error visible.
//   borrar_transcript_asr → nada más que el trabajo.
//   integrar_contexto → una propuesta cifrada, en la misma transacción que
//                      resuelve el trabajo; nunca mueve el hilo vigente.

import type { Prisma, TipoTrabajo } from "@prisma/client";

import type { db } from "@/lib/db";
import type { ResultadoTrabajo } from "@/lib/sesion-clinica/schema";

import { ApiError } from "../../responses";
import type { TrabajoAutorizado } from "../../tickets";
import { cifrarSesion } from "@/lib/prisma-encryption";

import { describirError } from "./politica";
import { resolverTrabajo, type EstadoResuelto } from "./resolver";
import { aplicarPropuesta } from "../hilo/trabajo";
import { bloquearHilo, type ClienteHilo } from "../hilo/base";

type ClienteResultado = ClienteHilo;

export type Aplicador = (
  tx: ClienteResultado,
  trabajo: TrabajoAutorizado,
  resultado: ResultadoTrabajo,
  resolucion: EstadoResuelto,
  ahora: Date,
) => Promise<void>;

/** La generación para la que se pidió el feedback, o null si el payload no la trae. */
function generacionDe(payload: unknown): number | null {
  const g = (payload as { generacion?: unknown } | null)?.generacion;
  return typeof g === "number" ? g : null;
}

async function aplicarFeedback(
  tx: ClienteResultado,
  trabajo: TrabajoAutorizado,
  resultado: ResultadoTrabajo,
  resolucion: EstadoResuelto,
): Promise<void> {
  if (!trabajo.sesionId) return;
  const generacion = generacionDe(trabajo.payload);
  if (generacion === null) {
    throw new ApiError("generar_feedback: el payload no trae `generacion`", 400);
  }
  if (resultado.ok) {
    if (resultado.feedback === undefined || resultado.feedback === null) {
      throw new ApiError("generar_feedback: falta `feedback` en un resultado ok", 400);
    }
    await tx.sesionClinica.updateMany({
      where: { id: trabajo.sesionId, feedbackEstado: "pendiente", generacion },
      data: {
        feedbackEstado: "listo",
        feedbackError: null,
        ...cifrarSesion(trabajo.sesionId, { feedback: resultado.feedback }),
      },
    });
    return;
  }
  if (resolucion.estado === "fallido") {
    await tx.sesionClinica.updateMany({
      where: { id: trabajo.sesionId, feedbackEstado: "pendiente", generacion },
      data: { feedbackEstado: "fallido", feedbackError: describirError(resultado.error) },
    });
  }
}

/** Un aplicador por tipo. */
export const APLICADORES: Partial<Record<TipoTrabajo, Aplicador>> = {
  generar_feedback: aplicarFeedback,
  borrar_transcript_asr: async () => {},
  integrar_contexto: aplicarPropuesta,
};

export interface ResultadoTrabajoWorkerInput {
  prisma: Pick<typeof db, "$transaction">;
  trabajo: TrabajoAutorizado;
  resultado: ResultadoTrabajo;
  aplicadores?: Partial<Record<TipoTrabajo, Aplicador>>;
  ahora?: Date;
}

export async function aplicarResultadoTrabajo({
  prisma,
  trabajo,
  resultado,
  aplicadores = APLICADORES,
  ahora = new Date(),
}: ResultadoTrabajoWorkerInput): Promise<EstadoResuelto> {
  const aplicar = aplicadores[trabajo.tipo];
  if (!aplicar) {
    throw new ApiError(
      `Todavía no hay quien aplique el resultado de ${trabajo.tipo}; el trabajo queda reclamado`,
      501,
    );
  }
  return prisma.$transaction(async (tx) => {
    if (trabajo.tipo === "integrar_contexto" && trabajo.pacienteId) {
      await bloquearHilo(tx, { pacienteId: trabajo.pacienteId, organizationId: trabajo.organizationId });
    }
    const resolucion = await resolverTrabajo({
      prisma: tx,
      trabajo: { id: trabajo.trabajoId, tipo: trabajo.tipo, intentos: trabajo.intentos },
      resultado: resultado.ok
        ? { ok: true, uso: resultado.uso as Prisma.InputJsonValue | undefined }
        : { ok: false, error: resultado.error, uso: resultado.uso as Prisma.InputJsonValue | undefined },
      ahora,
    });
    await aplicar(tx, trabajo, resultado, resolucion, ahora);
    return resolucion;
  });
}

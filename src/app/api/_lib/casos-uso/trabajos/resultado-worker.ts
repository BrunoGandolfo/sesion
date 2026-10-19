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
//
// Un resultado que la app rechaza por su forma (el Recorrido no pasa
// contenidoHiloSchema, o el aplicador responde 400) deja el trabajo fallido
// y definitivo, con el uso que se pagó. Antes la transacción se revertía, el
// trabajo quedaba reclamado hasta que vencía el lease y se repetía la
// llamada al modelo para recibir lo mismo.

import type { Prisma, TipoTrabajo } from "@prisma/client";
import { ZodError } from "zod";

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
  // Sin generación no hay qué feedback escribir; un fallo igual resuelve el
  // trabajo (si no, quedaría reclamado hasta que venza el lease).
  if (generacion === null) {
    if (!resultado.ok) return;
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

/** Por qué la app rechaza un resultado ok, si es por su forma: repetirlo da
 *  lo mismo. Nombra los campos, nunca su contenido. Un 409 (otra propuesta
 *  pendiente, la sesión ya no está) no es de forma: sigue como antes. */
function rechazoDeForma(error: unknown): string | null {
  if (error instanceof ZodError) {
    const campos = [...new Set(error.issues.map((i) => i.path.join(".") || "(raíz)"))];
    return `resultado_invalido: ${campos.slice(0, 5).join(", ")}`;
  }
  if (error instanceof ApiError && error.status === 400) return `resultado_invalido: ${error.message}`;
  return null;
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
  const resolver = (r: ResultadoTrabajo) => prisma.$transaction(async (tx) => {
    if (trabajo.tipo === "integrar_contexto" && trabajo.pacienteId) {
      await bloquearHilo(tx, { pacienteId: trabajo.pacienteId, organizationId: trabajo.organizationId });
    }
    const resolucion = await resolverTrabajo({
      prisma: tx,
      trabajo: { id: trabajo.trabajoId, tipo: trabajo.tipo, intentos: trabajo.intentos },
      resultado: r.ok
        ? { ok: true, uso: r.uso as Prisma.InputJsonValue | undefined }
        : { ok: false, error: r.error, definitivo: r.definitivo, uso: r.uso as Prisma.InputJsonValue | undefined },
      ahora,
    });
    await aplicar(tx, trabajo, r, resolucion, ahora);
    return resolucion;
  });
  try {
    return await resolver(resultado);
  } catch (error) {
    const rechazo = resultado.ok ? rechazoDeForma(error) : null;
    if (rechazo === null) throw error;
    return resolver({ ok: false, error: rechazo, definitivo: true, uso: resultado.uso });
  }
}

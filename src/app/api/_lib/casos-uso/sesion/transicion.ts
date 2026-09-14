// Una sola función arma el UPDATE condicionado de toda transición de estado
// de la sesión clínica y traduce `count = 0` a 409.
//
// El WHERE lleva SIEMPRE el id, la organización y el estado de partida que
// la tabla (src/lib/sesion-clinica/estados.ts) fija para la operación; para
// las del worker, además el `intento` vigente. Así un pedido atrasado —otra
// pestaña que aprobó, un worker con un intento viejo, una eliminación en el
// medio— no pisa nada: la base reevalúa el predicado con el lock de la fila
// y, si ya no coincide, no escribe.
//
// No lee la fila antes de escribir: leer y después escribir por id abre la
// ventana que esto cierra (S3 de la auditoría). Quien necesite datos de la
// fila para decidir (aprobar lee el riesgo) los lee, decide, y la escritura
// igual va condicionada.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import {
  operacion,
  type EstadoSesion,
  type NombreOperacion,
} from "@/lib/sesion-clinica/estados";

import { ApiError } from "../../responses";

/** Lo que las operaciones de sesión necesitan del cliente: vale tanto `db`
 *  como el `tx` de una transacción. */
export type ClienteSesion = Pick<
  typeof db,
  | "sesionClinica"
  | "audioSegmento"
  | "trabajo"
  | "turno"
  | "configuracion"
  | "hotWord"
  | "hiloVersion"
  | "workerEstado"
>;

/** Lo que necesitan las operaciones que abren su propia transacción: el
 *  cliente de la app (`db`), nunca un `tx`. */
export type ClienteTransaccional = ClienteSesion &
  Pick<typeof db, "$transaction">;

export interface TransicionInput {
  prisma: ClienteSesion;
  operacion: NombreOperacion;
  sesionId: string;
  organizationId: string;
  /** Obligatorio en las operaciones del worker: se rechaza si no es el vigente. */
  intento?: number;
  /** Condiciones extra sobre la fila (audioEstado, feedbackEstado…). */
  condiciones?: Prisma.SesionClinicaWhereInput;
  /** Lo que cambia además del estado. */
  data?: Omit<Prisma.SesionClinicaUpdateManyMutationInput, "estado">;
  /** Mensaje del 409. Uno por defecto que no miente. */
  conflicto?: string;
}

export const MENSAJE_CONFLICTO =
  "La sesión cambió mientras se procesaba el pedido. Volvé a abrirla.";

/** `where` de una transición: id, organización, estados de partida e intento. */
export function whereTransicion({
  operacion: nombre,
  sesionId,
  organizationId,
  intento,
  condiciones,
}: Omit<TransicionInput, "prisma" | "data" | "conflicto">): Prisma.SesionClinicaWhereInput {
  const op = operacion(nombre);
  if (op.desde.length === 0) {
    throw new Error(`La operación ${nombre} crea la fila: no es una transición`);
  }
  if (op.actor === "worker" && intento === undefined) {
    throw new Error(`La operación ${nombre} exige el intento vigente`);
  }
  const desde: EstadoSesion[] = [...op.desde];
  return {
    id: sesionId,
    organizationId,
    estado: desde.length === 1 ? desde[0] : { in: desde },
    ...(intento !== undefined ? { intento } : {}),
    ...(condiciones ?? {}),
  };
}

/**
 * Ejecuta la transición. Lanza ApiError 409 si la fila no estaba en el
 * estado de partida (o el intento no era el vigente, o no cumplía las
 * condiciones extra), y Error si se pide una operación que no cambia de
 * estado por UPDATE (eliminar: es un DELETE, ver eliminar.ts).
 */
export async function transicionar(input: TransicionInput): Promise<void> {
  const op = operacion(input.operacion);
  if (op.hacia === "borrada") {
    throw new Error(
      `La operación ${input.operacion} borra la fila: no pasa por transicionar`,
    );
  }
  const data = {
    ...(input.data ?? {}),
    ...(op.hacia === "mismo" ? {} : { estado: op.hacia }),
  };
  const { count } = await input.prisma.sesionClinica.updateMany({
    where: whereTransicion(input),
    // Sin nada que escribir, Prisma no ejecuta el UPDATE y devuelve 0: la
    // fila se toca igual para que el predicado se evalúe con su lock.
    data: Object.keys(data).length === 0 ? { actualizadaEn: new Date() } : data,
  });
  if (count === 0) {
    throw new ApiError(input.conflicto ?? MENSAJE_CONFLICTO, 409);
  }
}

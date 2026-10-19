import type { AmbitoCupo } from "@prisma/client";

import type { db } from "@/lib/db";
import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { ApiError } from "../../responses";
import { MENSAJE_TOPE_DIARIO, TOPE_PREGUNTAS_DIA } from "./topes";
import { MENSAJE_TOPE_LUX, TOPE_LUX_DIA } from "../lux/topes";

type ClienteCupo = Pick<typeof db, "$queryRaw" | "cupoAyuda">;
export interface ReservaAyuda { userId: string; dia: string; ambito?: AmbitoCupo }

/** Cada asistente tiene su tope y su mensaje: los cupos no se comen entre sí. */
const TOPES: Record<AmbitoCupo, { tope: number; mensaje: string }> = {
  ayuda: { tope: TOPE_PREGUNTAS_DIA, mensaje: MENSAJE_TOPE_DIARIO },
  lux: { tope: TOPE_LUX_DIA, mensaje: MENSAJE_TOPE_LUX },
};

/** El incremento condicional es una sola sentencia, incluso al crear el día. */
export async function reservarCupo(
  prisma: ClienteCupo, userId: string, ahora = new Date(), ambito: AmbitoCupo = "ayuda",
): Promise<ReservaAyuda> {
  const dia = fechaInputMvd(ahora);
  const { tope, mensaje } = TOPES[ambito];
  const filas = await prisma.$queryRaw<{ usadas: number }[]>`
    INSERT INTO cupos_ayuda (user_id, dia, ambito, usadas) VALUES (${userId}, ${dia}, ${ambito}::ambito_cupo, 1)
    ON CONFLICT (user_id, dia, ambito) DO UPDATE SET usadas = cupos_ayuda.usadas + 1
    WHERE cupos_ayuda.usadas < ${tope}
    RETURNING usadas`;
  if (!filas.length) throw new ApiError(mensaje, 429);
  return { userId, dia, ambito };
}

/**
 * Falló la llamada al proveedor de un asistente (Lupita o Lux), antes de que
 * empiece la respuesta. `devuelveCupo`: el proveedor contestó con un error
 * HTTP (4xx/5xx del handshake), así que no procesó ni cobró el pedido. Un
 * timeout o una conexión cortada sin status no lo devuelven: no se puede
 * saber si el proveedor llegó a procesarlo.
 */
export class ErrorProveedorAsistente extends ApiError {
  constructor(mensaje: string, readonly devuelveCupo = false) {
    super(mensaje, 502);
  }
}

/**
 * La regla del cupo, una sola para Lupita y Lux (decisión del dueño,
 * 2026-10-16): ante un error antes de abrir el stream, el cupo vuelve si el
 * pedido no llegó al proveedor (base, validación, sin clave) o si el
 * proveedor contestó un error HTTP. Se queda con un timeout o un corte; y
 * una vez abierto el stream no vuelve nunca, tampoco si se corta antes del
 * primer texto o ella cancela.
 */
export function cupoVuelveAnte(error: unknown): boolean {
  return !(error instanceof ErrorProveedorAsistente) || error.devuelveCupo;
}

/** Sólo cuando cupoVuelveAnte lo dice. */
export async function devolverCupo(prisma: ClienteCupo, reserva: ReservaAyuda) {
  await prisma.cupoAyuda.updateMany({
    where: { userId: reserva.userId, dia: reserva.dia, ambito: reserva.ambito ?? "ayuda", usadas: { gt: 0 } },
    data: { usadas: { decrement: 1 } },
  });
}

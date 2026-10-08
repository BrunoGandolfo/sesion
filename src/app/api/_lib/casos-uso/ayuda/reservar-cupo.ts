import type { AmbitoCupo } from "@prisma/client";

import type { db } from "@/lib/db";
import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { ApiError } from "../../responses";
import { MENSAJE_TOPE_DIARIO, TOPE_PREGUNTAS_DIA } from "../responder-ayuda";
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

/** Solo ante fallo antes del primer fragmento; cancelar conserva el consumo. */
export async function devolverCupo(prisma: ClienteCupo, reserva: ReservaAyuda) {
  await prisma.cupoAyuda.updateMany({
    where: { userId: reserva.userId, dia: reserva.dia, ambito: reserva.ambito ?? "ayuda", usadas: { gt: 0 } },
    data: { usadas: { decrement: 1 } },
  });
}

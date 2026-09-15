import type { db } from "@/lib/db";
import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { ApiError } from "../../responses";
import { MENSAJE_TOPE_DIARIO, TOPE_PREGUNTAS_DIA } from "../responder-ayuda";

type ClienteCupo = Pick<typeof db, "$queryRaw" | "cupoAyuda">;
export interface ReservaAyuda { userId: string; dia: string }

/** El incremento condicional es una sola sentencia, incluso al crear el día. */
export async function reservarCupo(prisma: ClienteCupo, userId: string, ahora = new Date()): Promise<ReservaAyuda> {
  const dia = fechaInputMvd(ahora);
  const filas = await prisma.$queryRaw<{ usadas: number }[]>`
    INSERT INTO cupos_ayuda (user_id, dia, usadas) VALUES (${userId}, ${dia}, 1)
    ON CONFLICT (user_id, dia) DO UPDATE SET usadas = cupos_ayuda.usadas + 1
    WHERE cupos_ayuda.usadas < ${TOPE_PREGUNTAS_DIA}
    RETURNING usadas`;
  if (!filas.length) throw new ApiError(MENSAJE_TOPE_DIARIO, 429);
  return { userId, dia };
}

/** Solo ante fallo antes del primer fragmento; cancelar conserva el consumo. */
export async function devolverCupo(prisma: ClienteCupo, reserva: ReservaAyuda) {
  await prisma.cupoAyuda.updateMany({ where: { ...reserva, usadas: { gt: 0 } }, data: { usadas: { decrement: 1 } } });
}

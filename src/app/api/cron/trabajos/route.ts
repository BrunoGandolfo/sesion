// Cron de trabajos de la app (ejecutor = app): hoy sólo `borrar_audio_r2`.
// Reclama y ejecuta de a uno mientras quede presupuesto (correr-app.ts), y
// resuelve cada uno (hecho / pendiente con backoff / fallido). Es el ÚNICO
// lugar de la app que llama a R2 para borrar. Programación: cada 10 minutos
// en vercel.json.

import { db } from "@/lib/db";
import { adaptadorBorradoR2, r2Configurado } from "@/lib/r2";

import { requireCron } from "../../_lib/auth";
import { ejecutarBorradoR2 } from "../../_lib/casos-uso/trabajos/ejecutar-borrado-r2";
import { correrTrabajosApp } from "../../_lib/casos-uso/trabajos/correr-app";
import { errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** De los 60 s de maxDuration: lo que se usa para trabajar, cuánto se
 *  reserva para tomar un trabajo más, y el plazo de ese trabajo entero
 *  (menor que la reserva: deja tiempo para resolverlo en la base). */
const PRESUPUESTO_MS = 50_000;
const RESERVA_POR_TRABAJO_MS = 30_000;
const PLAZO_TRABAJO_MS = RESERVA_POR_TRABAJO_MS - 2_000;

// El adaptador de R2 con timeout por llamada vive en src/lib/r2.ts
// (adaptadorBorradoR2): la ruta sólo lo pasa.

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  try {
    if (!r2Configurado()) {
      return Response.json({ error: "R2 no está configurado; no se ejecutó ningún trabajo" }, { status: 503 });
    }
    const resumen = await correrTrabajosApp({
      prisma: db,
      presupuestoMs: PRESUPUESTO_MS,
      reservaPorTrabajoMs: RESERVA_POR_TRABAJO_MS,
      ejecutar: async (trabajo) => {
        await ejecutarBorradoR2({ prisma: db, r2: adaptadorBorradoR2, trabajo, ahora: new Date(), plazoMs: PLAZO_TRABAJO_MS });
      },
    });
    return Response.json(resumen);
  } catch (error) {
    return errorResponse(error);
  }
}

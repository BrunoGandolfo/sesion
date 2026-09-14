// Una corrida del consumidor de la app (el cron): reclama y ejecuta trabajos
// de a UNO mientras quede presupuesto de tiempo. Reclamar de a uno, y no un
// lote, evita dejar trabajos reclamados (con lease) que la corrida no llegó a
// ejecutar; el presupuesto evita que Vercel corte la función a mitad de un
// trabajo largo sin que el resultado quede resuelto.

import type { db } from "@/lib/db";

import { reclamarTrabajos, type TrabajoReclamado } from "./reclamar";
import { resolverTrabajo, type ResultadoEjecucion } from "./resolver";

export interface ResumenCorrida {
  reclamados: number;
  hechos: number;
  reintentar: number;
  fallidos: number;
  /** true si quedó presupuesto y no había más trabajos. */
  agotoLaCola: boolean;
}

export interface CorrerTrabajosAppInput {
  prisma: Pick<typeof db, "trabajo" | "hiloVersion">;
  /** Ejecuta un trabajo; lanza si falla. */
  ejecutar: (trabajo: TrabajoReclamado) => Promise<void>;
  /** Milisegundos totales de la corrida. */
  presupuestoMs: number;
  /** Cuánto se reserva para ejecutar y resolver un trabajo: no se reclama
   *  uno nuevo si queda menos que esto. */
  reservaPorTrabajoMs: number;
  ahora?: () => Date;
}

export async function correrTrabajosApp({
  prisma,
  ejecutar,
  presupuestoMs,
  reservaPorTrabajoMs,
  ahora = () => new Date(),
}: CorrerTrabajosAppInput): Promise<ResumenCorrida> {
  const inicio = ahora().getTime();
  const resumen: ResumenCorrida = { reclamados: 0, hechos: 0, reintentar: 0, fallidos: 0, agotoLaCola: false };

  while (ahora().getTime() - inicio <= presupuestoMs - reservaPorTrabajoMs) {
    const [trabajo] = await reclamarTrabajos({ prisma, ejecutor: "app", ahora: ahora(), limite: 1 });
    if (!trabajo) {
      resumen.agotoLaCola = true;
      break;
    }
    resumen.reclamados += 1;

    let resultado: ResultadoEjecucion;
    try {
      await ejecutar(trabajo);
      resultado = { ok: true };
    } catch (error) {
      resultado = { ok: false, error };
    }
    const resolucion = await resolverTrabajo({ prisma, trabajo, resultado, ahora: ahora() });
    if (resolucion.estado === "hecho") resumen.hechos += 1;
    else if (resolucion.estado === "pendiente") resumen.reintentar += 1;
    else resumen.fallidos += 1;
  }
  return resumen;
}

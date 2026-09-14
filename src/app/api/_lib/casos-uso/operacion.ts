// Casos de uso de operación: lo que /api/health y /api/estado-worker
// preguntan a la base. Sin request ni Response: las rutas sólo traducen.

import type { db } from "@/lib/db";
import { estadoDelWorker, type EstadoWorker } from "@/lib/salud-metricas";

type ClientePrisma = Pick<typeof db, "$queryRaw" | "workerEstado">;

/** Una consulta trivial: true si la base contesta. Lanza si no. */
export async function verificarBase(prisma: Pick<ClientePrisma, "$queryRaw">): Promise<true> {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

/** La fila única de worker_estado, interpretada con el umbral del latido. */
export async function leerEstadoWorker(
  prisma: Pick<ClientePrisma, "workerEstado">,
  ahora: Date,
): Promise<EstadoWorker> {
  const fila = await prisma.workerEstado.findUnique({
    where: { id: "worker" },
    select: { ultimoPollEn: true, version: true },
  });
  return estadoDelWorker(fila, ahora);
}

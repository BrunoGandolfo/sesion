// Señal de vida del worker sin ruta nueva (esquema: worker_estado, una sola
// fila). La actualiza cada reclamo (poll) y cada escritura del worker
// (lease, checkpoint, asr, resultado, trabajo). Best-effort: nunca voltea la
// operación que la acompaña.

import type { db } from "@/lib/db";

export const WORKER_ESTADO_ID = "worker";

export interface LatidoInput {
  prisma: Pick<typeof db, "workerEstado">;
  workerId: string;
  version: string;
  ahora: Date;
  /** poll = GET /pendientes; trabajo = cualquier escritura del worker. */
  tipo: "poll" | "trabajo";
}

/** Identidad del worker desde los headers que manda app_client.py. */
export function identidadWorker(request: Request): { workerId: string; version: string } {
  return {
    workerId: request.headers.get("x-worker-id")?.slice(0, 120) || "desconocido",
    version: request.headers.get("x-worker-version")?.slice(0, 120) || "desconocida",
  };
}

export async function registrarLatido({ prisma, workerId, version, ahora, tipo }: LatidoInput): Promise<void> {
  try {
    await prisma.workerEstado.upsert({
      where: { id: WORKER_ESTADO_ID },
      create: {
        id: WORKER_ESTADO_ID,
        workerId,
        version,
        ultimoPollEn: ahora,
        ultimoTrabajoEn: tipo === "trabajo" ? ahora : null,
      },
      update: {
        workerId,
        version,
        ...(tipo === "poll" ? { ultimoPollEn: ahora } : { ultimoTrabajoEn: ahora }),
      },
    });
  } catch (error) {
    console.error("[latido] no se pudo registrar", error instanceof Error ? error.name : error);
  }
}

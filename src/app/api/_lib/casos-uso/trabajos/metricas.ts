// Lo que el cron de salud (Área 5) necesita saber de los trabajos, sin
// repetir lo hecho: cuántos quedaron `fallido` y cuántos `pendiente` con más
// de 24 h. Un trabajo que llegó a `hecho` deja de contar solo.

import type { db } from "@/lib/db";

export const TRABAJO_ATRASADO_MS = 24 * 60 * 60 * 1000;

export interface MetricasTrabajos {
  fallidos: number;
  atrasados: number;
}

export async function metricasTrabajos(
  prisma: Pick<typeof db, "trabajo">,
  ahora: Date,
): Promise<MetricasTrabajos> {
  const [fallidos, atrasados] = await Promise.all([
    prisma.trabajo.count({ where: { estado: "fallido" } }),
    prisma.trabajo.count({
      where: {
        estado: { in: ["pendiente", "en_curso"] },
        creadoEn: { lt: new Date(ahora.getTime() - TRABAJO_ATRASADO_MS) },
      },
    }),
  ]);
  return { fallidos, atrasados };
}

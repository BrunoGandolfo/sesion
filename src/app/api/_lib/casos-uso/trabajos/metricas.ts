// Lo que el cron de salud (Área 5) necesita saber de los trabajos, sin
// repetir lo hecho: cuántos quedaron `fallido` y cuántos `pendiente` con más
// de 24 h. Un trabajo que llegó a `hecho` deja de contar solo.
//
// Un `integrar_contexto` pendiente que la regla de encadenado no deja
// entregar (la paciente tiene una propuesta del Recorrido sin resolver, o una
// integración anterior sin terminar) NO está atrasado: espera a que la
// profesional resuelva la propuesta, y eso puede tardar días. Contarlo
// mandaba el mismo correo cada hora (29-sep, dos tareas de un paciente de
// prueba). La regla es la de reclamar.ts, importada: si cambia allá, cambia
// acá.

import type { FuenteMetricas } from "@/lib/salud-metricas";
import type { db } from "@/lib/db";

import { bloqueadoPorEncadenado } from "./reclamar";

export const TRABAJO_ATRASADO_MS = 24 * 60 * 60 * 1000;

export interface MetricasTrabajos {
  fallidos: number;
  atrasados: number;
}

export async function metricasTrabajos(
  prisma: Pick<typeof db, "trabajo" | "hiloVersion">,
  ahora: Date,
): Promise<MetricasTrabajos> {
  const [fallidos, viejos] = await Promise.all([
    prisma.trabajo.count({ where: { estado: "fallido" } }),
    prisma.trabajo.findMany({
      where: {
        estado: { in: ["pendiente", "en_curso"] },
        creadoEn: { lt: new Date(ahora.getTime() - TRABAJO_ATRASADO_MS) },
      },
      select: { id: true, tipo: true, estado: true, pacienteId: true, creadoEn: true },
    }),
  ]);
  let atrasados = 0;
  for (const trabajo of viejos) {
    // Sólo un pendiente puede estar esperando por la regla: uno en curso ya
    // se entregó, y si quedó trabado sí es un atraso.
    const esperaALaProfesional =
      trabajo.tipo === "integrar_contexto" &&
      trabajo.estado === "pendiente" &&
      (await bloqueadoPorEncadenado(prisma, trabajo));
    if (!esperaALaProfesional) atrasados += 1;
  }
  return { fallidos, atrasados };
}

/** Un solo fallo o trabajo de más de 24 h requiere revisión, incluso con worker vivo. */
export const fuenteTrabajos: FuenteMetricas = async ({ prisma, ahora }) => {
  const { fallidos, atrasados } = await metricasTrabajos(prisma, ahora);
  return [
    { nombre: "trabajos_fallidos", valor: fallidos, umbral: 1, nivel: "aviso",
      texto: "tareas fallidas: revisar la cola de trabajos y su causa antes de reintentar" },
    { nombre: "trabajos_atrasados", valor: atrasados, umbral: 1, nivel: "aviso",
      texto: "tareas pendientes o en curso hace más de 24 h (sin contar las que esperan una propuesta del Recorrido): revisar el consumidor y los reintentos" },
  ];
};

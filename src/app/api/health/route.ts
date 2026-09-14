// Endpoint público para el monitor externo (UptimeRobot, BetterStack o el que
// contrate el dueño) y para .github/workflows/latido.yml.
//
// La respuesta es un semáforo y nada más: { status: "ok", commit } con 200,
// o { status: "error" } con 503. Nunca `error.message`: antes se devolvía el
// detalle de Prisma a cualquiera que hiciera GET sin autenticarse (host de
// la base, driver). El diagnóstico va a Sentry o al log, no a la respuesta.
//
// Dos cosas hacen 503:
//   - la base no responde (SELECT 1 falla);
//   - en producción falta alguna variable de operación (env-operacion.ts):
//     sin alertas o sin SMS el sistema no está sano aunque responda, y así
//     el monitor lo ve en el primer deploy y no el día que hacía falta.
//
// `commit` es el sha corto que Vercel inyecta: sirve para que el monitor (o
// una persona) compare lo que está corriendo con el HEAD de `release`.

import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db";
import { validarEnvOperacion } from "@/lib/env-operacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

function reportar(mensaje: string, error?: unknown): void {
  try {
    if (Sentry.getClient()) {
      if (error !== undefined) Sentry.captureException(error);
      else Sentry.captureMessage(mensaje, "error");
      return;
    }
  } catch {
    // Un fallo del propio SDK no puede tumbar el health check.
  }
  console.error(`[health] ${mensaje}`, error ?? "");
}

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  const { faltantes, produccion } = validarEnvOperacion();
  if (produccion && faltantes.length > 0) {
    reportar(`faltan variables de operación: ${faltantes.join(", ")}`);
    return Response.json({ status: "error" }, { status: 503 });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", commit });
  } catch (error) {
    reportar("la base no respondió", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}

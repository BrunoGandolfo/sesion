// Endpoint público para servicios de monitoreo (UptimeRobot, etc.).
// El middleware excluye /api/health del auth.
//
// La respuesta es un semáforo y nada más: { status: "ok" } con 200, o
// { status: "error" } con 503. Antes devolvía `error.message` de Prisma a
// cualquiera que hiciera GET sin autenticarse: una URL de conexión, el
// nombre del host de la base o el detalle del driver, servidos en abierto.
// El diagnóstico no se pierde —va a Sentry, o a los logs si el SDK no está
// inicializado en este entorno—, pero no viaja en la respuesta.

import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reportar(error: unknown): void {
  try {
    // getClient() es undefined si Sentry no se inicializó (dev, tests, o
    // sin DSN): ahí el detalle va a los logs del servidor.
    if (Sentry.getClient()) {
      Sentry.captureException(error);
      return;
    }
  } catch {
    // Un fallo del propio SDK no puede tumbar el health check.
  }
  console.error("[health] la base no respondió", error);
}

export async function GET() {
  try {
    // Verificar conexión a la DB con un query mínimo.
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (error) {
    reportar(error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}

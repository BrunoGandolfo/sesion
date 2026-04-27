import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Endpoint público para servicios de monitoreo (UptimeRobot, etc.).
// El middleware excluye /api/health del auth.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Verificar conexión a la DB con un query mínimo.
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 503 },
    );
  }
}

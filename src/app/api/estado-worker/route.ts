// GET /api/estado-worker — ¿el worker Python está vivo?
//
// Público, sin sesión: lo consulta el monitor externo cada 15 minutos y
// .github/workflows/latido.yml, y un monitor no puede autenticarse
// cómodamente. No revela nada: una marca de tiempo y una versión.
//
// Lee la fila única de worker_estado, que la app actualiza en cada
// GET /api/sesion-clinica/pendientes (área 2). Acá sólo se lee. Sin poll en
// más de LATIDO_MAXIMO_SEG → 503, que es lo que el monitor entiende.
//
// Tiene que estar fuera del matcher de src/middleware.ts (contrato con el
// área 3): si no, el middleware lo redirige a /login y el monitor ve un 307.

import { db } from "@/lib/db";
import { estadoDelWorker, LATIDO_MAXIMO_SEG } from "@/lib/salud-metricas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET() {
  try {
    const fila = await db.workerEstado.findUnique({
      where: { id: "worker" },
      select: { ultimoPollEn: true, version: true },
    });
    const estado = estadoDelWorker(fila, new Date());
    return Response.json(
      {
        status: estado.vivo ? "ok" : "error",
        ultimoPollEn: estado.ultimoPollEn?.toISOString() ?? null,
        edadSegundos: estado.edadSegundos,
        maximoSegundos: LATIDO_MAXIMO_SEG,
        version: estado.version,
      },
      { status: estado.vivo ? 200 : 503 },
    );
  } catch (error) {
    console.error("[estado-worker] la base no respondió", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}

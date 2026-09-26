// GET /api/cron/mantenimiento — Bearer CRON_SECRET. Diario (vercel.json:
// "0 4 * * *" UTC, contrato con el área 5). Purga las tablas operativas a 30
// días, re-cifra una tanda de filas con clave vieja y, al final, abandona las
// grabaciones sin terminar de más de siete días (si R2 está configurado).
// `?recifrar=todo` sigue hasta agotar o hasta 50 s, para apurar una rotación
// a mano.
import { db } from "@/lib/db";
import { almacenAudio, r2Configurado } from "@/lib/r2";

import { requireCron } from "../../_lib/auth";
import { mantenimiento } from "../../_lib/casos-uso/mantenimiento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  const todo = new URL(request.url).searchParams.get("recifrar") === "todo";
  try {
    const resultado = await mantenimiento({
      prisma: db,
      ahora: new Date(),
      todo,
      presupuestoMs: 50_000,
      ...(r2Configurado() ? { almacen: almacenAudio } : {}),
    });
    console.log(
      `[mantenimiento] purga=${JSON.stringify(resultado.purga)} recifradas=${resultado.recifrado.recifradas} pendientes=${resultado.recifrado.pendientes} errores=${resultado.recifrado.errores} huerfanas=${JSON.stringify(resultado.huerfanas ?? null)}`,
    );
    return Response.json(resultado);
  } catch (error) {
    console.error("[mantenimiento] la corrida falló", error);
    return Response.json({ error: "El mantenimiento no se pudo completar" }, { status: 500 });
  }
}

// Cron de salud. La ruta hace tres cosas y ninguna es decidir: autentica el
// cron, le pide el diagnóstico al agregador (../../_lib/casos-uso/salud.ts)
// y, si hay algo que decir, lo manda por correo con src/lib/alertas.ts.
//
// Y una cuarta que antes no hacía: si el agregador LANZA —lo más probable es
// que la base no responda—, eso es la alerta más importante que este sistema
// puede emitir, y hasta ahora se perdía en un 500. Ahora se alerta y se
// contesta 503.

import { db } from "@/lib/db";
import { alertar } from "@/lib/alertas";

import { requireCron } from "../../_lib/auth";
import { revisarSalud } from "../../_lib/casos-uso/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  const ahora = new Date();

  let salud;
  try {
    salud = await revisarSalud({ prisma: db, ahora });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[salud] el agregador falló", error);
    const alertaEnviada = await alertar(
      "critico",
      "El cron de salud no pudo revisar el sistema",
      { error: msg.slice(0, 200), cuando: ahora.toISOString() },
    );
    return Response.json({ status: "error", alertaEnviada }, { status: 503 });
  }

  const alertaEnviada =
    salud.alerta && salud.nivel
      ? await alertar(
          salud.nivel,
          `${salud.alertas.length} ${salud.alertas.length === 1 ? "aviso" : "avisos"} de salud`,
          Object.fromEntries(salud.alertas.map((m) => [m.nombre, `${m.valor} ${m.texto}`])),
          { ahora },
        )
      : false;

  return Response.json({
    metricas: salud.metricas,
    alertas: salud.alertas.map((m) => m.nombre),
    nivel: salud.nivel,
    alertaEnviada,
  });
}

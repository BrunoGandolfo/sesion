// Cron de salud. La ruta hace tres cosas y ninguna es decidir: autentica el
// cron, le pide el diagnóstico al caso de uso (../../_lib/casos-uso/salud.ts)
// y, si hay algo que decir, lo manda por webhook (ALERTA_WEBHOOK_URL) o, si
// no está configurado, por console.warn.
//
// Qué se mira y con qué umbrales está todo en el caso de uso, que es donde se
// puede testear: un archivo de ruta no exporta nada más que el handler y su
// configuración, así que ni las constantes se podían mirar desde un test.
import { db } from "@/lib/db";

import { requireCron } from "../../_lib/auth";
import { revisarSalud } from "../../_lib/casos-uso/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

const WEBHOOK_TIMEOUT_MS = 10_000;

async function enviarAlerta(texto: string): Promise<boolean> {
  const url = process.env.ALERTA_WEBHOOK_URL;
  if (!url) {
    console.warn(`[salud] ${texto}`);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[salud] webhook respondió ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[salud] fallo al enviar alerta: ${msg}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  const {
    alerta,
    sesionesTrabadas,
    recordatoriosFallidos,
    recordatoriosTrabados,
    smsTrasCancelacion,
    sesionesSinContexto,
    sesionesSinContextoSaturado,
    minutosAudioDelMes,
    topeMinutosAudioMes,
  } = await revisarSalud({ prisma: db, ahora: new Date() });

  const alertaEnviada = alerta ? await enviarAlerta(alerta) : false;

  return Response.json({
    sesionesTrabadas,
    recordatoriosFallidos,
    /** Reservas de envío que el rescate no está pudiendo sacar. */
    recordatoriosTrabados,
    /** SMS que salieron con el turno ya cerrado: pacientes a las que hay que
     *  avisar a mano. */
    smsTrasCancelacion,
    sesionesSinContexto,
    /** true si se llegó al tope: sesionesSinContexto es un piso. */
    sesionesSinContextoSaturado,
    /** Control de gasto: minutos de audio transcriptos en el mes de
     *  Montevideo, y el techo con el que se comparan. Van siempre, se cruce o
     *  no el umbral: la idea es poder mirar la curva, no enterarse recién
     *  cuando explota. */
    minutosAudioDelMes,
    topeMinutosAudioMes,
    alertaEnviada,
  });
}

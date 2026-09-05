// Cron de salud: mira los tres tramos donde el pipeline se puede parar sin
// que nadie se entere, y avisa por webhook (ALERTA_WEBHOOK_URL) o, si no está
// configurado, por console.warn.
//
//   1. sesiones trabadas en "procesando" (el worker no contestó);
//   2. recordatorios fallidos en las últimas 24 h (Twilio o el número);
//   3. sesiones aprobadas hace más de 24 h que el Golden Thread no integró
//      (la Llamada B del worker dejó de correr).
//
// El tercero es el más silencioso de los tres: la nota está aprobada, el
// audio ya se borró y la app se ve perfecta; lo único que pasa es que el hilo
// del proceso —lo que ella lee antes de la próxima sesión— se quedó viejo.
import { db } from "@/lib/db";

import { requireCron } from "../../_lib/auth";
import { contarSesionesSinContextoAtrasadas } from "../../_lib/casos-uso/sesiones-sin-contexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOS_HORAS_MS = 2 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 10_000;

// Umbrales explícitos: a partir de cuántos deja de ser ruido y pasa a ser
// aviso. Los tres son 1 —cualquier caso merece una mirada— pero escritos,
// para que subir uno sea cambiar un número y no una comparación.
const UMBRAL_SESIONES_TRABADAS = 1;
const UMBRAL_RECORDATORIOS_FALLIDOS = 1;
const UMBRAL_SIN_CONTEXTO = 1;

/** Cuánto puede tardar la integración al hilo antes de considerarse atrasada.
 *  El worker la hace enseguida de aprobar; un día es holgura, no expectativa. */
const RETRASO_CONTEXTO_MS = UN_DIA_MS;

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

  const ahora = Date.now();

  const [sesionesTrabadas, recordatoriosFallidos, sinContexto] =
    await Promise.all([
      db.sesionClinica.count({
        where: {
          estado: "procesando",
          updatedAt: { lt: new Date(ahora - DOS_HORAS_MS) },
        },
      }),
      db.recordatorio.count({
        where: {
          estado: "fallido",
          actualizadoEn: { gte: new Date(ahora - UN_DIA_MS) },
        },
      }),
      contarSesionesSinContextoAtrasadas({
        prisma: db,
        hasta: new Date(ahora - RETRASO_CONTEXTO_MS),
      }),
    ]);

  const sesionesSinContexto = sinContexto.cantidad;
  const sesionesSinContextoSaturado = sinContexto.saturado;

  const hayAlgo =
    sesionesTrabadas >= UMBRAL_SESIONES_TRABADAS ||
    recordatoriosFallidos >= UMBRAL_RECORDATORIOS_FALLIDOS ||
    sesionesSinContexto >= UMBRAL_SIN_CONTEXTO;

  let alertaEnviada = false;

  if (hayAlgo) {
    const cuantas = sesionesSinContextoSaturado
      ? `${sesionesSinContexto}+`
      : `${sesionesSinContexto}`;
    const texto =
      `Sesión: ${sesionesTrabadas} sesiones en procesando hace más de 2 h; ` +
      `${recordatoriosFallidos} recordatorios fallidos en 24 h; ` +
      `${cuantas} sesiones aprobadas hace más de 24 h sin integrar al hilo`;
    alertaEnviada = await enviarAlerta(texto);
  }

  return Response.json({
    sesionesTrabadas,
    recordatoriosFallidos,
    sesionesSinContexto,
    /** true si se llegó al tope: sesionesSinContexto es un piso. */
    sesionesSinContextoSaturado,
    alertaEnviada,
  });
}

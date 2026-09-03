// Cron de salud: detecta sesiones clínicas trabadas en "procesando" y
// recordatorios fallidos recientes; avisa por webhook (ALERTA_WEBHOOK_URL)
// o, si no está configurado, por console.warn.
import { db } from "@/lib/db";

import { requireCron } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOS_HORAS_MS = 2 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
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

  const ahora = Date.now();

  const [sesionesTrabadas, recordatoriosFallidos] = await Promise.all([
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
  ]);

  let alertaEnviada = false;

  if (sesionesTrabadas > 0 || recordatoriosFallidos > 0) {
    const texto = `Sesión: ${sesionesTrabadas} sesiones en procesando hace más de 2 h; ${recordatoriosFallidos} recordatorios fallidos en 24 h`;
    alertaEnviada = await enviarAlerta(texto);
  }

  return Response.json({ sesionesTrabadas, recordatoriosFallidos, alertaEnviada });
}

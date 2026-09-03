// Cron de recordatorios por SMS. Se autentica con CRON_SECRET.
//
// La política (claim optimista, vencimiento, envío, persistencia del
// resultado) vive en _lib/casos-uso/enviar-recordatorios.ts. Acá solo auth,
// chequeo de configuración del canal (env de Twilio) y respuesta. La bitácora
// de la corrida vuelve en la respuesta (`eventos`); a consola solo van los
// fallos al persistir un error, que son los que dejan la fila inconsistente.

import { db } from "@/lib/db";
import { sendSms, smsConfigurado } from "@/lib/recordatorios-sms";

import { requireCron } from "../../_lib/auth";
import { enviarRecordatoriosVencidos } from "../../_lib/casos-uso/enviar-recordatorios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTENTOS = 3;

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  const ahora = new Date();

  // Sin canal configurado no se toca ningún recordatorio: quedan pendientes
  // hasta que exista TWILIO_SMS_FROM + credenciales.
  const cfg = smsConfigurado();
  if (!cfg.ok) {
    return Response.json({
      procesados: 0,
      enviados: 0,
      fallidos: 0,
      saltados: 0,
      vencidos: 0,
      desactivado: cfg.motivo,
      eventos: [
        `[cron] SMS desactivado: ${
          cfg.motivo === "falta_from"
            ? "falta TWILIO_SMS_FROM"
            : "faltan credenciales de Twilio"
        } ts=${ahora.toISOString()}`,
      ],
    });
  }

  const resumen = await enviarRecordatoriosVencidos({
    prisma: db,
    ahora,
    enviarSms: sendSms,
    maxIntentos: MAX_INTENTOS,
  });

  for (const fallo of resumen.fallosPersistencia) {
    console.error(fallo);
  }

  return Response.json(resumen);
}

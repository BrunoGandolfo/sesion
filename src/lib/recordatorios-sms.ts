// Recordatorios por SMS vía Twilio (Tanda 1: reemplaza el canal WhatsApp).
// Este módulo es SOLO el cliente de envío y las reglas del cron; el texto
// (template, variables, conteo de longitud) vive en src/lib/sms-texto.ts,
// que es puro y lo importa también la UI.
//
// Referencia verificada: https://www.twilio.com/docs/messaging/api/message-resource
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
//   Content-Type: application/x-www-form-urlencoded, HTTP Basic (SID:token).
//   From: número Twilio en E.164 (para SMS, SIN prefijo `whatsapp:`).
//   To:   destinatario en E.164.
//   Body: hasta 1.600 caracteres; Twilio segmenta a 160 (GSM-7) / 70 (UCS-2).
//   201 → { sid, status: "queued"|"accepted", num_segments, ... }
//   >=400 → { code, message, more_info, status }
import { normalizePhone } from "@/lib/phone";
import { buildSmsMessage } from "@/lib/sms-texto";

/** @deprecated Importar desde "@/lib/sms-texto". Se re-exporta solo para
 *  los importadores existentes (cron de recordatorios). */
export {
  asegurarLineaContacto,
  buildSmsMessage,
  contarLongitudSms,
  LINEA_CONTACTO,
  TEMPLATE_SMS_SUGERIDO,
} from "@/lib/sms-texto";
/** @deprecated Importar desde "@/lib/sms-texto". */
export type { LongitudSms, SmsTemplateData } from "@/lib/sms-texto";

/** @deprecated Nombre previo (src/lib/whatsapp.ts). Usar buildSmsMessage
 *  de "@/lib/sms-texto". */
export const buildReminderMessage = buildSmsMessage;

export interface SmsMessage {
  to: string;
  text: string;
}

export interface SmsResult {
  success: boolean;
  error?: string;
  sid?: string;
}

export type SmsConfigStatus =
  | { ok: true }
  | { ok: false; motivo: "falta_from" | "faltan_credenciales" };

// Timeout defensivo para que un cron no quede colgado si Twilio no responde.
const TIMEOUT_MS = 15_000;

// Forma del payload de error que devuelve Twilio en respuestas >= 400.
interface TwilioError {
  code?: number;
  message?: string;
  more_info?: string;
  status?: number;
}

interface TwilioMessageCreated {
  sid?: string;
  status?: string;
}

export function smsConfigurado(): SmsConfigStatus {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_SMS_FROM;

  if (!fromNumber) return { ok: false, motivo: "falta_from" };
  if (!accountSid || !authToken) {
    return { ok: false, motivo: "faltan_credenciales" };
  }
  return { ok: true };
}

export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  const cfg = smsConfigurado();
  if (!cfg.ok) {
    return {
      success: false,
      error:
        cfg.motivo === "falta_from"
          ? "SMS no configurado: falta TWILIO_SMS_FROM"
          : "SMS no configurado: faltan credenciales de Twilio",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN as string;
  const fromNumber = process.env.TWILIO_SMS_FROM as string;

  // Cinturón de seguridad: datos viejos pueden tener espacios o guiones.
  let normalizedTo: string;
  try {
    normalizedTo = normalizePhone(message.to);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Teléfono inválido: ${msg}` };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  // Twilio exige x-www-form-urlencoded en este endpoint; JSON es rechazado.
  const body = new URLSearchParams({
    From: fromNumber,
    To: normalizedTo,
    Body: message.text,
  });

  // SID y token son ASCII: btoa alcanza y no depende de Buffer.
  const basicAuth = btoa(`${accountSid}:${authToken}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (response.status >= 400) {
      const detail = (await response.json().catch(() => null)) as
        | TwilioError
        | null;
      const code = detail?.code ?? response.status;
      const twilioMessage = detail?.message ?? "Error desconocido";
      return {
        success: false,
        error: `Twilio ${code}: ${twilioMessage}`,
      };
    }

    const created = (await response.json().catch(() => null)) as
      | TwilioMessageCreated
      | null;
    return { success: true, sid: created?.sid };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: "Timeout: Twilio no respondió en 15s",
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Fallo de red: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Un recordatorio no tiene sentido si el turno ya pasó o fue cancelado /
 *  marcado ausente. Pura, sin acceso a base: la usa el cron y los tests. */
export function estaVencido(
  turno: { fecha: Date; estado: string },
  ahora: Date,
): boolean {
  if (turno.estado === "cancelado" || turno.estado === "ausente") return true;
  return turno.fecha.getTime() < ahora.getTime();
}

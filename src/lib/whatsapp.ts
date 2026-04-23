import { format } from "date-fns";
import { es } from "date-fns/locale";

import { normalizePhone } from "@/lib/phone";

export interface WhatsAppMessage {
  to: string;
  text: string;
}

export interface WhatsAppResult {
  success: boolean;
  error?: string;
}

// Timeout defensivo para que un cron no quede colgado si Twilio no responde.
const TIMEOUT_MS = 15_000;

// Forma del payload de error que devuelve Twilio en respuestas >= 400.
// Ver https://www.twilio.com/docs/usage/twilios-response.
interface TwilioError {
  code?: number;
  message?: string;
  more_info?: string;
  status?: number;
}

export async function sendWhatsApp(
  message: WhatsAppMessage,
): Promise<WhatsAppResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, error: "Twilio no configurado" };
  }

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
    To: `whatsapp:${normalizedTo}`,
    Body: message.text,
  });

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

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

    return { success: true };
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

export function buildReminderMessage(
  template: string,
  data: {
    nombre: string;
    apellido: string;
    fecha: Date;
    direccion: string;
    profesional: string;
  },
): string {
  const fechaFmt = format(data.fecha, "EEEE d 'de' MMMM", { locale: es });
  const horaFmt = format(data.fecha, "HH:mm");

  return template
    .replaceAll("{{nombre}}", data.nombre)
    .replaceAll("{{apellido}}", data.apellido)
    .replaceAll("{{fecha}}", fechaFmt)
    .replaceAll("{{hora}}", horaFmt)
    .replaceAll("{{direccion}}", data.direccion)
    .replaceAll("{{profesional}}", data.profesional);
}

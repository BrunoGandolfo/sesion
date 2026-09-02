// Recordatorios por SMS vía Twilio (Tanda 1: reemplaza el canal WhatsApp).
//
// Referencia verificada: https://www.twilio.com/docs/messaging/api/message-resource
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
//   Content-Type: application/x-www-form-urlencoded, HTTP Basic (SID:token).
//   From: número Twilio en E.164 (para SMS, SIN prefijo `whatsapp:`).
//   To:   destinatario en E.164.
//   Body: hasta 1.600 caracteres; Twilio segmenta a 160 (GSM-7) / 70 (UCS-2).
//   201 → { sid, status: "queued"|"accepted", num_segments, ... }
//   >=400 → { code, message, more_info, status }
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { normalizePhone } from "@/lib/phone";

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

/** Línea de contacto OBLIGATORIA por diseño: todo SMS termina indicando a
 *  quién y a qué número escribir para cambios. El cron la agrega si el
 *  template guardado por la usuaria no la contiene. */
export const LINEA_CONTACTO =
  "Para cambios, comunicate con {{profesional}} al {{telefonoConsultorio}}";

/** Template sugerido (mismo texto que DEFAULT_TEMPLATE en config-view.tsx).
 *  Con datos realistas (Lucía / martes 21 de abril / 10:00 / Mariana Roldán /
 *  +598 99 876 543) rinde 133 caracteres. Como el español lleva tildes
 *  ("sesión", "Lucía", "Roldán") el mensaje viaja en UCS-2 → 2 segmentos.
 *  Quitar las tildes del template no alcanza: los nombres propios las traen. */
export const TEMPLATE_SMS_SUGERIDO = `Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}. ${LINEA_CONTACTO}`;

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

  // btoa (y no Buffer): este módulo también lo importa config-view.tsx
  // ("use client") por contarLongitudSms; SID y token son ASCII.
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

export interface SmsTemplateData {
  nombre: string;
  apellido: string;
  fecha: Date;
  direccion: string;
  profesional: string;
  /** Teléfono del consultorio. Sale de Configuracion.whatsappOrigen (la
   *  columna conserva ese nombre hasta la próxima migración). */
  telefonoConsultorio?: string;
}

export function buildSmsMessage(
  template: string,
  data: SmsTemplateData,
): string {
  const fechaFmt = format(data.fecha, "EEEE d 'de' MMMM", { locale: es });
  const horaFmt = format(data.fecha, "HH:mm");

  return template
    .replaceAll("{{nombre}}", data.nombre)
    .replaceAll("{{apellido}}", data.apellido)
    .replaceAll("{{fecha}}", fechaFmt)
    .replaceAll("{{hora}}", horaFmt)
    .replaceAll("{{direccion}}", data.direccion)
    .replaceAll("{{profesional}}", data.profesional)
    .replaceAll("{{telefonoConsultorio}}", data.telefonoConsultorio ?? "");
}

/** Alias de compatibilidad (nombre previo en src/lib/whatsapp.ts). */
export const buildReminderMessage = buildSmsMessage;

/** Garantiza que el template termine con la línea de contacto obligatoria.
 *  Si ya la contiene, lo devuelve tal cual. */
export function asegurarLineaContacto(template: string): string {
  if (template.includes(LINEA_CONTACTO)) return template;
  const base = template.trimEnd();
  return base.length === 0 ? LINEA_CONTACTO : `${base}\n${LINEA_CONTACTO}`;
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

// ---------------------------------------------------------------------------
// Conteo de longitud SMS (GSM 03.38 básico + extensión vs UCS-2)
// ---------------------------------------------------------------------------

// Alfabeto GSM 03.38 básico (1 septeto por carácter). Incluye é, ñ, ü, à, Ñ,
// pero NO í, ó, á, ú (esas fuerzan UCS-2).
const GSM7_BASICO =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// Extensión GSM 03.38 (escape + carácter → 2 septetos).
const GSM7_EXTENSION = "\f^{}\\[~]|€";

const GSM7_SIMPLE = 160;
const GSM7_CONCATENADO = 153;
const UCS2_SIMPLE = 70;
const UCS2_CONCATENADO = 67;

export interface LongitudSms {
  /** Unidades cobradas: septetos en GSM-7 (extensión cuenta 2) o code units
   *  UTF-16 en UCS-2. */
  caracteres: number;
  segmentos: number;
  gsm7: boolean;
}

export function contarLongitudSms(texto: string): LongitudSms {
  let septetos = 0;
  let gsm7 = true;

  for (const ch of texto) {
    if (GSM7_BASICO.includes(ch)) {
      septetos += 1;
    } else if (GSM7_EXTENSION.includes(ch)) {
      septetos += 2;
    } else {
      gsm7 = false;
      break;
    }
  }

  if (gsm7) {
    const segmentos =
      septetos === 0
        ? 0
        : septetos <= GSM7_SIMPLE
          ? 1
          : Math.ceil(septetos / GSM7_CONCATENADO);
    return { caracteres: septetos, segmentos, gsm7: true };
  }

  // UCS-2: cada code unit UTF-16 ocupa 2 bytes; los emoji (pares sustitutos)
  // cuentan doble, igual que en Twilio.
  const unidades = texto.length;
  const segmentos =
    unidades === 0
      ? 0
      : unidades <= UCS2_SIMPLE
        ? 1
        : Math.ceil(unidades / UCS2_CONCATENADO);
  return { caracteres: unidades, segmentos, gsm7: false };
}

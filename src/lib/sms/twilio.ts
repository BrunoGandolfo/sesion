// Habla con Twilio y nada más. Devuelve qué pasó en cuatro formas —aceptado,
// transitorio, definitivo, desconocido— y NO decide qué hacer con eso: eso
// es del despachador (casos-uso/despachar-sms.ts) con la tabla de
// src/lib/sms/clasificar.ts.
//
// Referencia verificada: https://www.twilio.com/docs/messaging/api/message-resource
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
//   Content-Type: application/x-www-form-urlencoded, HTTP Basic (SID:token).
//   From: número Twilio en E.164. To: destinatario en E.164. Body.
//   StatusCallback: URL a la que Twilio postea los cambios de estado.
//   201 → { sid, status: "queued"|"accepted", num_segments: "2", … }
//   >=400 → { code, message, more_info, status }
//
// DESCONOCIDO ES UNA RESPUESTA, NO UN ERROR
//
// Si el cuerpo pudo haber llegado a Twilio y no hay una respuesta legible
// —timeout esperando la respuesta, conexión cortada, 2xx sin JSON— el
// mensaje puede haber salido. Reintentar es arriesgarse a mandarlo dos
// veces; darlo por fallido es mentir. Se devuelve `desconocido`, la fila
// queda en ese estado y una persona lo mira (decisión del dueño: no se
// concilia solo ni se reenvía).
//
// Lo único que se considera transitorio del lado del cliente es un fallo
// ANTES de conectar: DNS que no resuelve, conexión rechazada. Ahí el cuerpo
// no viajó.

import { clasificarRespuesta, type Clasificacion } from "./clasificar";

/** Timeout de la llamada. Diez segundos: con concurrencia 5 y un deadline
 *  de 45 s por corrida, un Twilio colgado no consume la corrida entera. */
export const TIMEOUT_TWILIO_MS = 10_000;

export interface PedidoSms {
  /** E.164. */
  destino: string;
  texto: string;
  /** URL pública a la que Twilio postea el estado (src/lib/sms/firma.ts). */
  statusCallback: string;
}

export type ResultadoTwilio =
  | { tipo: "aceptado"; sid: string; segmentos: number | null; estadoTwilio: string | null }
  | { tipo: "transitorio"; codigo: number | null; httpStatus: number | null; mensaje: string; clasificacion: Clasificacion }
  | { tipo: "definitivo"; codigo: number | null; httpStatus: number; mensaje: string; clasificacion: Clasificacion }
  | { tipo: "desconocido"; motivo: string };

export type EnviadorSms = (pedido: PedidoSms) => Promise<ResultadoTwilio>;

export type SmsConfigStatus =
  | { ok: true }
  | { ok: false; motivo: "falta_from" | "faltan_credenciales" };

export function smsConfigurado(env: Record<string, string | undefined> = process.env): SmsConfigStatus {
  if (!env.TWILIO_SMS_FROM) return { ok: false, motivo: "falta_from" };
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return { ok: false, motivo: "faltan_credenciales" };
  }
  return { ok: true };
}

interface TwilioError {
  code?: number;
  message?: string;
  status?: number;
}

interface TwilioMessageCreated {
  sid?: string;
  status?: string;
  num_segments?: string | number;
}

/** Códigos de error de red que significan "no se llegó a conectar". */
const ANTES_DE_CONECTAR = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]);

function codigoDeRed(error: unknown): string | null {
  const causa = (error as { cause?: { code?: string } } | null)?.cause;
  return typeof causa?.code === "string" ? causa.code : null;
}

export interface OpcionesTwilio {
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/**
 * POST a Messages.json. Nunca lanza: todo termina en un ResultadoTwilio.
 */
export async function enviarSmsTwilio(
  pedido: PedidoSms,
  opciones: OpcionesTwilio = {},
): Promise<ResultadoTwilio> {
  const env = opciones.env ?? process.env;
  const cfg = smsConfigurado(env);
  if (!cfg.ok) {
    // Configuración, no red: se reintenta con backoff hasta la ventana útil
    // y el validador de entorno es quien lo grita.
    return {
      tipo: "transitorio",
      codigo: null,
      httpStatus: null,
      mensaje: cfg.motivo === "falta_from" ? "falta TWILIO_SMS_FROM" : "faltan credenciales de Twilio",
      clasificacion: { clase: "transitorio", alerta: "critico", referencia: "src/lib/env-operacion.ts" },
    };
  }

  const accountSid = env.TWILIO_ACCOUNT_SID as string;
  const authToken = env.TWILIO_AUTH_TOKEN as string;
  const from = env.TWILIO_SMS_FROM as string;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const body = new URLSearchParams({
    From: from,
    To: pedido.destino,
    Body: pedido.texto,
    StatusCallback: pedido.statusCallback,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opciones.timeoutMs ?? TIMEOUT_TWILIO_MS);

  let response: Response;
  try {
    response = await (opciones.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const red = codigoDeRed(error);
    if (red && ANTES_DE_CONECTAR.has(red)) {
      return {
        tipo: "transitorio",
        codigo: null,
        httpStatus: null,
        mensaje: `fallo de red antes de conectar (${red})`,
        clasificacion: { clase: "transitorio", referencia: "red" },
      };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { tipo: "desconocido", motivo: `Twilio no respondió en ${(opciones.timeoutMs ?? TIMEOUT_TWILIO_MS) / 1000} s` };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { tipo: "desconocido", motivo: `la conexión con Twilio se cortó (${red ?? msg})` };
  }
  clearTimeout(timer);

  if (response.status >= 400) {
    const detalle = (await response.json().catch(() => null)) as TwilioError | null;
    const codigo = typeof detalle?.code === "number" ? detalle.code : null;
    const clasificacion = clasificarRespuesta(response.status, codigo);
    const mensaje = detalle?.message ?? `HTTP ${response.status}`;
    return clasificacion.clase === "transitorio"
      ? { tipo: "transitorio", codigo, httpStatus: response.status, mensaje, clasificacion }
      : { tipo: "definitivo", codigo, httpStatus: response.status, mensaje, clasificacion };
  }

  const creado = (await response.json().catch(() => null)) as TwilioMessageCreated | null;
  if (!creado?.sid) {
    // 2xx sin un cuerpo legible: Twilio probablemente lo aceptó y no
    // tenemos el sid. No se reintenta.
    return { tipo: "desconocido", motivo: `Twilio contestó ${response.status} sin un cuerpo legible` };
  }
  const segmentos = Number(creado.num_segments);
  return {
    tipo: "aceptado",
    sid: creado.sid,
    segmentos: Number.isFinite(segmentos) && segmentos > 0 ? segmentos : null,
    estadoTwilio: creado.status ?? null,
  };
}

// Validación de `X-Twilio-Signature`. Puro (node:crypto): lo usan las rutas
// Node /api/sms/callback y /api/sms/entrante, nunca el proxy.
//
// Cómo firma Twilio (https://www.twilio.com/docs/usage/webhooks/webhooks-security
// y https://www.twilio.com/docs/usage/security#validating-requests):
//   1. la URL completa del webhook, con query string si la hay;
//   2. los parámetros POST ordenados alfabéticamente por clave, cada uno
//      concatenado como clave+valor, sin separadores;
//   3. HMAC-SHA1 de eso con el Auth Token como clave;
//   4. en base64.
// Se compara en tiempo constante. Sin firma válida → 403 y nada más: sin
// esto, cualquiera marca mensajes como entregados o da de baja un teléfono.
//
// LA URL ES LA PÚBLICA, NO LA QUE VE LA FUNCIÓN. Detrás del proxy de Vercel
// el request trae otro host y otro esquema; Twilio firmó contra la URL que
// tiene configurada en la consola, y ésa es una constante de acá. Al cambiar
// de dominio hay que tocar ORIGEN_PUBLICO y la configuración de Twilio (ver
// docs/operaciones.md).
//
// Vectores de prueba (src/lib/__tests__/firma.test.ts): el de la
// documentación oficial y el del SDK oficial twilio-python.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Origen público de la app. Twilio firma contra esta URL. */
const ORIGEN_PUBLICO = "https://sesionapp.app";

const RUTA_CALLBACK = "/api/sms/callback";
const RUTA_ENTRANTE = "/api/sms/entrante";

export const URL_CALLBACK = `${ORIGEN_PUBLICO}${RUTA_CALLBACK}`;
export const URL_ENTRANTE = `${ORIGEN_PUBLICO}${RUTA_ENTRANTE}`;

/** La firma que Twilio calcularía para esta URL y estos parámetros. */
export function firmaTwilio(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let datos = url;
  for (const clave of Object.keys(params).sort()) {
    datos += clave + params[clave];
  }
  return createHmac("sha1", authToken).update(datos, "utf8").digest("base64");
}

/** True si `firma` (el header) es la de esta URL y estos parámetros. */
export function firmaValida(
  authToken: string,
  url: string,
  params: Record<string, string>,
  firma: string | null,
): boolean {
  if (!firma) return false;
  const esperada = Buffer.from(firmaTwilio(authToken, url, params), "utf8");
  const recibida = Buffer.from(firma, "utf8");
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}

/** Los parámetros de un cuerpo x-www-form-urlencoded, como objeto plano. */
export function parametrosDeFormulario(cuerpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [clave, valor] of new URLSearchParams(cuerpo)) {
    out[clave] = valor;
  }
  return out;
}

export type MotivoRechazo = "sin_token" | "cuerpo_grande" | "sin_firma" | "firma";

/**
 * La línea que deja un 403 en el log de la ruta /api/sms/callback. Durante semanas los
 * callbacks llegaron y se rechazaron sin dejar rastro (diagnóstico del
 * 7-oct, docs/operaciones.md §6): el 403 se veía en Vercel, el porqué no.
 *
 * Sólo lo que sirve para separar las causas y no es secreto: el motivo, el
 * MessageSid, el estado que traía y si el AccountSid del callback es el de
 * nuestra cuenta. Con la URL exacta y el AccountSid nuestro, una firma que
 * no valida sólo puede ser un Auth Token que no es el que firma (el
 * secundario, o uno de otra cuenta). Nunca el cuerpo, la firma ni el token.
 */
export function lineaRechazo(
  motivo: MotivoRechazo,
  params: Record<string, string>,
  cuentaPropia: string | undefined = process.env.TWILIO_ACCOUNT_SID,
): string {
  const sid = params.MessageSid ?? params.SmsSid;
  const estado = params.MessageStatus ?? params.SmsStatus;
  const cuenta = params.AccountSid;
  const datos = {
    motivo,
    ...(sid ? { sid: sid.slice(0, 40) } : {}),
    ...(estado ? { estado: estado.slice(0, 20) } : {}),
    ...(cuenta ? { cuentaPropia: Boolean(cuentaPropia) && cuenta === cuentaPropia } : {}),
  };
  return `[sms-callback] 403 ${JSON.stringify(datos)}`;
}

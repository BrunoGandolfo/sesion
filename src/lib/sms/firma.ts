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
export const ORIGEN_PUBLICO = "https://sesionapp.app";

export const RUTA_CALLBACK = "/api/sms/callback";
export const RUTA_ENTRANTE = "/api/sms/entrante";

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

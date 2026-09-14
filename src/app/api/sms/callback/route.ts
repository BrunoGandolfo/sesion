// POST /api/sms/callback — el StatusCallback de Twilio.
//
// Público (fuera del matcher de src/proxy.ts), Node, y con la firma
// X-Twilio-Signature validada PRIMERO contra la URL pública
// (src/lib/sms/firma.ts). Sin firma válida → 403 y nada más: sin esto,
// cualquiera marca mensajes como entregados y el sistema miente sobre lo
// único que le pedimos.
//
// Lo que se escribe está en casos-uso/sms-webhooks.ts (aplicarCallbackTwilio).
// Referencia: https://www.twilio.com/docs/messaging/api/message-resource#twilios-request-to-the-statuscallback-url

import { db } from "@/lib/db";
import { alertar } from "@/lib/alertas";
import { firmaValida, parametrosDeFormulario, URL_CALLBACK } from "@/lib/sms/firma";

import { aplicarCallbackTwilio } from "../../_lib/casos-uso/sms-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

const MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const crudo = await request.text();
  if (!token || crudo.length > MAX_BYTES) {
    return new Response(null, { status: 403 });
  }
  const params = parametrosDeFormulario(crudo);
  if (!firmaValida(token, URL_CALLBACK, params, request.headers.get("x-twilio-signature"))) {
    return new Response(null, { status: 403 });
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const estado = params.MessageStatus ?? params.SmsStatus ?? "";
  const codigoCrudo = params.ErrorCode ? Number(params.ErrorCode) : null;
  const codigo = codigoCrudo !== null && Number.isFinite(codigoCrudo) ? codigoCrudo : null;
  if (!sid) return new Response(null, { status: 204 });

  try {
    const resultado = await aplicarCallbackTwilio(db, { sid, estado, codigo, ahora: new Date() });
    if (resultado.efecto === "no_entregado" && resultado.actualizados > 0 && resultado.alerta) {
      await alertar(resultado.alerta, "El operador está filtrando los SMS", {
        codigo,
        sid,
        motivo: resultado.motivoNoEnvio,
      });
    }
  } catch (error) {
    console.error("[sms-callback] no se pudo escribir el estado", error);
    // 500: Twilio reintenta el callback más tarde.
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 204 });
}

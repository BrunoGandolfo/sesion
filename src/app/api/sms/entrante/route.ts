// POST /api/sms/entrante — un SMS que una paciente le mandó al número.
//
// Existe para una sola cosa: la baja. Si el cuerpo, normalizado (minúsculas,
// sin tildes, sin espacios), es "baja", "stop" o "cancelar", el teléfono
// entra en bajas_sms y no recibe más NADA de este número (todos los motivos:
// decisión del dueño), y se le contesta que quedó dado de baja. Cualquier
// otro texto: 204 y se descarta sin guardar ni loguear nada — no queremos
// el contenido de lo que las pacientes escriben.
//
// Público (fuera del matcher de src/proxy.ts), con la firma de Twilio
// validada primero. La escritura vive en casos-uso/sms-webhooks.ts.
// Referencia del webhook entrante:
// https://www.twilio.com/docs/messaging/guides/webhook-request

import { db } from "@/lib/db";
import { firmaValida, parametrosDeFormulario, URL_ENTRANTE } from "@/lib/sms/firma";

import { esPedidoDeBaja, registrarBajaPorRespuesta } from "../../_lib/casos-uso/sms-webhooks";

export { normalizarRespuesta, PALABRAS_DE_BAJA } from "../../_lib/casos-uso/sms-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

const MAX_BYTES = 16 * 1024;

const TWIML_BAJA =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Listo: no vas a recibir más mensajes de este número.</Message></Response>';

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const crudo = await request.text();
  if (!token || crudo.length > MAX_BYTES) {
    return new Response(null, { status: 403 });
  }
  const params = parametrosDeFormulario(crudo);
  if (!firmaValida(token, URL_ENTRANTE, params, request.headers.get("x-twilio-signature"))) {
    return new Response(null, { status: 403 });
  }

  const desde = params.From?.trim();
  if (!desde || !esPedidoDeBaja(params.Body ?? "")) {
    return new Response(null, { status: 204 });
  }

  try {
    await registrarBajaPorRespuesta(db, desde, new Date());
  } catch (error) {
    console.error("[sms-entrante] no se pudo registrar la baja", error);
    return new Response(null, { status: 500 });
  }

  return new Response(TWIML_BAJA, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

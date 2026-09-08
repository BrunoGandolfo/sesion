// GET /api/sms/estado — ¿el canal de SMS está configurado?
//
// Existe porque la pantalla de Cobros tiene que saberlo ANTES de ofrecer el
// botón: si no hay Twilio, el aviso no puede salir y mostrar el botón es
// prometer algo que va a fallar. La respuesta es un booleano y, cuando es
// que no, el motivo (falta el número o faltan las credenciales) — nunca los
// valores: acá no viaja ninguna variable de entorno.
//
// No va dentro de /api/config: eso devuelve la fila de Configuracion, y esto
// no es un dato de la organización sino del despliegue.

import { smsConfigurado } from "@/lib/recordatorios-sms";

import { getSessionActor } from "../../_lib/auth";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Con sesión: es información del consultorio, no pública.
    await getSessionActor();
    return ok(smsConfigurado());
  } catch (error) {
    return errorResponse(error);
  }
}

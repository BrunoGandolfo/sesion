// POST /api/cuenta/limpiar → borra la cookie SOLO si no resuelve a una sesión
// viva (vencida, cerrada, inexistente). Con una sesión viva no toca nada.
//
// Es lo que la pantalla de entrada tiene que llamar cuando llega con
// ?sesion=vencida (el layout del dashboard la manda ahí con una cookie
// muerta). Llamar a /api/cuenta/salir desde ahí era un logout CSRF: bastaba
// hacer navegar a la usuaria a /login?sesion=x para que la página cerrara su
// sesión viva. Acá, una sesión viva sale intacta.
import { cookieBorrada } from "@/lib/sesion-cookie";

import { buscarActor } from "../../_lib/auth";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST() {
  try {
    const actor = await buscarActor();
    const respuesta = ok({ viva: actor !== null });
    if (!actor) respuesta.headers.append("Set-Cookie", cookieBorrada());
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

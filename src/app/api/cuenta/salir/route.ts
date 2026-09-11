// POST /api/cuenta/salir → cierra ESTA sesión (motivo salida) y borra la
// cookie. Si la cookie no resuelve a una sesión viva (vencida, cerrada), la
// borra igual y contesta 200: salir siempre tiene que poder.
import { db } from "@/lib/db";
import { cerrarSesion } from "@/lib/sesion-acceso";
import { cookieBorrada } from "@/lib/sesion-cookie";

import { buscarActor } from "../../_lib/auth";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST() {
  try {
    const actor = await buscarActor();
    if (actor) {
      await cerrarSesion(db, { id: actor.sesionId, userId: actor.userId, motivo: "salida", ahora: new Date() });
    }
    const respuesta = ok({ ok: true });
    respuesta.headers.append("Set-Cookie", cookieBorrada());
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/cuenta/sesiones → quién está entrada y desde dónde. Sin IP en la
// respuesta: existe para investigar un incidente, no para mostrarla.
import { db } from "@/lib/db";
import { listarSesionesVivas } from "@/lib/sesion-acceso";

import { getSessionActor } from "../../_lib/auth";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  try {
    const actor = await getSessionActor();
    const sesiones = await listarSesionesVivas(db, actor.userId, new Date());
    const respuesta = ok({
      usuaria: { nombre: actor.nombre, email: actor.email, rol: actor.rol },
      sesiones: sesiones.map((s) => ({
        id: s.id,
        creadaEn: s.creadaEn,
        ultimoUsoEn: s.ultimoUsoEn,
        userAgent: s.userAgent,
        actual: s.id === actor.sesionId,
      })),
    });
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

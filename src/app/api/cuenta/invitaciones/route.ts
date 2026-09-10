import { dbAuth } from "@/lib/db-auth";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { getSessionActor } from "../../_lib/auth";
import { crearInvitacion } from "../../_lib/casos-uso/registrar-cuenta";
import { errorResponse, ok } from "../../_lib/responses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() {
  try {
    const { userId } = await getSessionActor();
    // No acepta organizationId ni email del cuerpo: siempre un consultorio nuevo.
    const respuesta = ok(await crearInvitacion(userId, repositorioRegistro(dbAuth)));
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) { return errorResponse(error); }
}

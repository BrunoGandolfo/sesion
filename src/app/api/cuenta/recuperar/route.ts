import { after } from "next/server";
import { z } from "zod";
import { dbAuth } from "@/lib/db-auth";
import { enviarCorreo } from "@/lib/correo";
import { repositorioRecuperacion } from "@/lib/cuenta-recuperacion-db";
import { ENTRADA_RECUPERAR_ENVIADO } from "@/lib/glosario";
import { solicitarRecuperacion } from "../../_lib/casos-uso/recuperar-cuenta";
import { ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const schema = z.object({ email: z.string().trim().email().max(254).toLowerCase() });

export async function POST(request: Request) {
  const datos = schema.safeParse(await request.json().catch(() => null));
  if (datos.success) {
    // La DB y Resend trabajan DESPUÉS de responder: tampoco su latencia revela
    // si el email existe. Next mantiene viva la función hasta terminar after().
    after(async () => {
      try {
        await solicitarRecuperacion(datos.data.email, { repo: repositorioRecuperacion(dbAuth), enviar: enviarCorreo });
      } catch {
        console.error("[cuenta.recuperar] no se pudo completar el pedido; respuesta pública sin cambios");
      }
    });
  }
  return ok({ mensaje: ENTRADA_RECUPERAR_ENVIADO });
}

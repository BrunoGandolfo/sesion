// Cambiar la contraseña de la usuaria logueada. La regla (contraseña actual,
// límite de intentos, una transacción que cambia, invalida enlaces, cierra
// todas las sesiones y deja el rastro) vive en casos-uso/cambiar-password.ts.
// La respuesta borra la cookie y dice `reingresar: true`; la pantalla la
// manda a /login con aviso.

import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { BCRYPT_RONDAS } from "@/lib/password";
import { huellaDeRequest } from "@/lib/request-huella";
import { cookieBorrada } from "@/lib/sesion-cookie";

import { getSessionActor } from "../../_lib/auth";
import { cambiarPassword } from "../../_lib/casos-uso/cambiar-password";
import { errorResponse, leerJson, okSinCache, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

const bodySchema = z.object({
  actual: z.string().min(1, "Falta la contraseña actual"),
  nueva: z.string().min(1, "Falta la contraseña nueva"),
});

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const parsed = bodySchema.safeParse(await leerJson(request));
    if (!parsed.success) return validationError(parsed.error);

    await cambiarPassword(
      { organizationId, userId, ...parsed.data },
      {
        prisma: db,
        hashear: (password) => bcrypt.hash(password, BCRYPT_RONDAS),
        comparar: bcrypt.compare,
        huella: huellaDeRequest(request),
      },
    );

    const respuesta = okSinCache({ cambiada: true, reingresar: true });
    respuesta.headers.append("Set-Cookie", cookieBorrada());
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

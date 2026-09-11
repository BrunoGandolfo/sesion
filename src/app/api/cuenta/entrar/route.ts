// POST /api/cuenta/entrar { email, password } → 200 { ok: true } + cookie.
// 401 con el mismo mensaje para email inexistente, contraseña mal y bloqueo
// por intentos (indistinguibles, a propósito). 503 si la transacción que
// serializa el intento no se pudo completar.
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ENTRADA_ERROR } from "@/lib/glosario";
import { huellaDeRequest } from "@/lib/request-huella";
import { cookieDeSesion } from "@/lib/sesion-cookie";

import { iniciarSesion } from "../../_lib/casos-uso/iniciar-sesion";
import { ApiError, errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(1000),
});

export async function POST(request: Request) {
  try {
    const datos = schema.parse(await request.json());
    const resultado = await iniciarSesion({
      prisma: db,
      email: datos.email,
      password: datos.password,
      huella: huellaDeRequest(request),
      comparar: bcrypt.compare,
      hashear: bcrypt.hash,
    });

    if (resultado.estado === "indisponible") {
      throw new ApiError("No pudimos procesar la entrada en este momento. Probá de nuevo.", 503);
    }
    if (resultado.estado === "rechazado") {
      throw new ApiError(ENTRADA_ERROR, 401);
    }

    const respuesta = ok({ ok: true });
    respuesta.headers.append("Set-Cookie", cookieDeSesion(resultado.resultado.token));
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    return errorResponse(error);
  }
}

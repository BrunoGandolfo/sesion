// POST /api/cuenta/registro → crea organización, usuaria, configuración y la
// sesión en una transacción; responde 201 con la cookie puesta. El
// formulario ya no hace un segundo paso de entrada.
import bcrypt from "bcryptjs";
import { z } from "zod";

import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { db } from "@/lib/db";
import { ENTRADA_CUENTA_ERROR } from "@/lib/glosario";
import { BCRYPT_RONDAS } from "@/lib/password";
import { huellaDeRequest } from "@/lib/request-huella";
import { hashTokenSesion, nuevoTokenSesion } from "@/lib/sesion-acceso";
import { cookieDeSesion } from "@/lib/sesion-cookie";

import { registrarCuenta } from "../../_lib/casos-uso/registrar-cuenta";
import { ApiError, errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

const schema = z.object({
  token: z.string().max(64),
  nombre: z.string().max(120),
  email: z.string().max(254),
  password: z.string().max(1000),
  aceptaTerminos: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    const tokenSesion = nuevoTokenSesion();
    await registrarCuenta(schema.parse(await request.json()), {
      repo: repositorioRegistro(db),
      hashear: (password) => bcrypt.hash(password, BCRYPT_RONDAS),
      tokenSesion,
      hashTokenSesion,
      huella: huellaDeRequest(request),
    });
    const respuesta = ok({ creada: true }, 201);
    respuesta.headers.append("Set-Cookie", cookieDeSesion(tokenSesion));
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) return errorResponse(error);
    console.error("[cuenta.registro] fallo interno sin datos personales");
    return Response.json({ error: ENTRADA_CUENTA_ERROR }, { status: 500 });
  }
}

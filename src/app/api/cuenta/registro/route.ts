import bcrypt from "bcryptjs";
import { z } from "zod";
import { dbAuth } from "@/lib/db-auth";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { BCRYPT_RONDAS } from "@/lib/password";
import { ENTRADA_CUENTA_ERROR } from "@/lib/glosario";
import { registrarCuenta } from "../../_lib/casos-uso/registrar-cuenta";
import { ApiError, errorResponse, ok } from "../../_lib/responses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().max(64), nombre: z.string().max(120), email: z.string().max(254), password: z.string().max(1000), aceptaTerminos: z.boolean().default(false) });
export async function POST(request: Request) {
  try {
    await registrarCuenta(schema.parse(await request.json()), { repo: repositorioRegistro(dbAuth), hashear: password => bcrypt.hash(password, BCRYPT_RONDAS) });
    // El formulario inicia sesión por el mismo signIn de credentials que /login.
    return ok({ creada: true }, 201);
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) return errorResponse(error);
    console.error("[cuenta.registro] fallo interno sin datos personales");
    return Response.json({ error: ENTRADA_CUENTA_ERROR }, { status: 500 });
  }
}

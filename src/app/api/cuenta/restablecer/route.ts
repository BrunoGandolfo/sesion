import bcrypt from "bcryptjs";
import { z } from "zod";
import { ENTRADA_CUENTA_ERROR } from "@/lib/glosario";
import { dbAuth } from "@/lib/db-auth";
import { BCRYPT_RONDAS } from "@/lib/password";
import { repositorioRecuperacion } from "@/lib/cuenta-recuperacion-db";
import { restablecerCuenta } from "../../_lib/casos-uso/recuperar-cuenta";
import { registrarAuditoria } from "../../_lib/auditoria";
import { ApiError, errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().max(64), password: z.string().max(1000) });
export async function POST(request: Request) {
  try {
    const datos = schema.parse(await request.json());
    const user = await restablecerCuenta(datos, {
      repo: repositorioRecuperacion(dbAuth),
      hashear: (password) => bcrypt.hash(password, BCRYPT_RONDAS), comparar: bcrypt.compare,
    });
    await registrarAuditoria({ organizationId: user.organizationId, actorTipo: "usuario",
      actorId: user.userId, accion: "cuenta.restablecer", entidad: "usuario", entidadId: user.userId });
    return ok({ cambiada: true });
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) return errorResponse(error);
    console.error("[cuenta.restablecer] fallo interno sin datos de la credencial");
    return Response.json({ error: ENTRADA_CUENTA_ERROR }, { status: 500 });
  }
}

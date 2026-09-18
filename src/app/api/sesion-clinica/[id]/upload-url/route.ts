// Paso 1 de la subida directa a R2 (sin pasar por Vercel).
//
// Se emite una URL prefirmada PUT de R2 con la key calculada de la sesión,
// Content-Type y Content-Length firmados, válida 60 min, y la sesión pasa
// grabando → subiendo. El audio va tal como se grabó. El navegador hace el
// PUT directo a R2 (paso 2) y después confirma con POST [id]/upload-confirmar
// (paso 3), que verifica con HeadObject.
//
// Reintento: si el PUT o la confirmación fallan, el cliente vuelve la sesión
// a "grabando" (POST [id]/volver-a-grabar) y repite desde acá con el mismo blob.

import { db } from "@/lib/db";
import { almacenAudio, r2Configurado } from "@/lib/r2";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { EXPIRA_URL_SUBIDA_SEGUNDOS, pedirUrlSubida } from "../../../_lib/casos-uso/audio";
import { ApiError, errorResponse, ok, validationError } from "../../../_lib/responses";
import { uploadUrlSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const parsed = uploadUrlSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    if (!r2Configurado()) {
      throw new ApiError("El almacenamiento de audio (R2) no está configurado en este entorno", 503);
    }

    const subida = await pedirUrlSubida({ prisma: db, organizationId, sesionId: id, ...parsed.data, almacen: almacenAudio });

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.subir_audio_inicio",
      entidad: "sesion_clinica",
      entidadId: id,
      detalle: { tamanoBytes: parsed.data.tamanoBytes, mime: parsed.data.mime, expiraEnSegundos: EXPIRA_URL_SUBIDA_SEGUNDOS },
    });

    return ok({ url: subida.url, key: subida.key, expiraEn: subida.expiraEn.toISOString(), headers: subida.headers });
  } catch (error) {
    return errorResponse(error);
  }
}

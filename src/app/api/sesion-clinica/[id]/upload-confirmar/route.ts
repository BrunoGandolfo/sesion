// Paso 3 de la subida: el único cierre de la grabación. El servidor pregunta
// a R2 (HeadObject) si el objeto está; si no, la sesión vuelve a grabando y
// responde 409 para que el teléfono repita. Si está, subiendo → procesando.

import { db } from "@/lib/db";
import { almacenAudio, r2Configurado } from "@/lib/r2";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import { confirmarSubida, diagnosticoParaAuditoria, MENSAJE_NO_LLEGO } from "../../../_lib/casos-uso/audio";
import { ApiError, errorResponse, ok, validationError } from "../../../_lib/responses";
import { uploadConfirmarSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const parsed = uploadConfirmarSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    if (!r2Configurado()) {
      throw new ApiError("El almacenamiento de audio (R2) no está configurado en este entorno", 503);
    }

    const auditar = (detalle: Record<string, unknown>) =>
      registrarAuditoria(db, { organizationId, actorTipo: "usuario", actorId: userId, accion: "sesion.subir_audio_fin", entidad: "sesion_clinica", entidadId: id, detalle });

    try {
      const { diagnostico, ...cierre } = parsed.data;
      const { bytes, sesion } = await confirmarSubida({ prisma: db, organizationId, sesionId: id, ...cierre, almacen: almacenAudio });
      // El diagnóstico del grabador queda acá y sólo acá: horas, motivos y
      // conteos para no volver a adivinar por qué se cortó una grabación. Va
      // aplanado: la auditoría descarta los objetos anidados sin avisar.
      await auditar({ ok: true, duracionAudioSeg: cierre.duracionAudioSeg, bytes, ...(diagnostico ? diagnosticoParaAuditoria(diagnostico) : {}) });
      return ok(sesion);
    } catch (error) {
      if (error instanceof ApiError && error.message === MENSAJE_NO_LLEGO) {
        await auditar({ ok: false, motivo: "objeto_ausente" });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

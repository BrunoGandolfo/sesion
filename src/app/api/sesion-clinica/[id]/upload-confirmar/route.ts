// Paso 3 de la subida directa a R2: el navegador terminó el PUT y avisa.
//
// Nunca se confía en la key que manda el cliente: se recalcula la key
// determinística de la sesión y se exige que coincida. Después se verifica
// con HeadObject que el objeto realmente existe en R2. Recién ahí la sesión
// pasa subiendo → procesando (el worker la levanta por /pendientes).
//
// Si el objeto no está (PUT interrumpido, URL vencida, CORS), la sesión
// vuelve a "grabando" y se responde 409: el cliente repite desde
// /upload-url con el mismo blob.

import { z } from "zod";
import { db } from "@/lib/db";
import { esKeyAudioDeSesion } from "@/lib/sesion-clinica-utils";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";
import {
  assertTransicionValida,
  sinClaveTemporal,
} from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const MENSAJE_NO_LLEGO =
  "El audio no llegó a R2. La sesión volvió a 'grabando': reintentá la subida.";

const bodySchema = z.object({
  key: z.string().trim().min(1, "Falta la key del audio"),
  duracionAudioSeg: z
    .number()
    .int("La duración debe ser un número entero")
    .nonnegative("La duración no puede ser negativa"),
});

// Respuesta con la misma forma que el GET por id (sin transcripción ni
// clave temporal): los hooks del cliente la normalizan igual.
const SESION_SELECT = {
  id: true,
  turnoId: true,
  estado: true,
  duracionAudioSeg: true,
  audioR2Key: true,
  audioBorradoEn: true,
  notaSubjetivo: true,
  notaObjetivo: true,
  notaAnalisis: true,
  notaPlan: true,
  datosEstructurados: true,
  modeloASR: true,
  modeloLLM: true,
  procesadoEn: true,
  aprobadoEn: true,
  error: true,
  intentos: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: { id: true, estado: true, turnoId: true },
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    if (sesion.estado !== "subiendo") {
      throw new ApiError(
        `Solo se puede confirmar una subida en curso (estado actual: ${sesion.estado})`,
        409,
      );
    }

    if (
      !esKeyAudioDeSesion(
        parsed.data.key,
        organizationId,
        sesion.id,
        sesion.turnoId,
      )
    ) {
      throw new ApiError("La key no corresponde a esta sesión", 400);
    }
    const key = parsed.data.key;

    const r2 = await import("@/lib/r2");
    if (!r2.r2Configurado()) {
      throw new ApiError(
        "El almacenamiento de audio (R2) no está configurado en este entorno",
        503,
      );
    }

    const { existe, bytes } = await r2.existeAudio(key);

    if (!existe) {
      assertTransicionValida(sesion.estado, "grabando");
      await db.sesionClinica.updateMany({
        where: { id: sesion.id, estado: "subiendo" },
        data: { estado: "grabando", error: MENSAJE_NO_LLEGO },
      });
      await registrarAuditoria({
        organizationId,
        actorTipo: "usuario",
        actorId: userId,
        accion: "sesion.subir_audio_fin",
        entidad: "sesion_clinica",
        entidadId: sesion.id,
        detalle: { ok: false, motivo: "objeto_ausente" },
      });
      throw new ApiError(MENSAJE_NO_LLEGO, 409);
    }

    assertTransicionValida(sesion.estado, "procesando");
    const { count } = await db.sesionClinica.updateMany({
      where: { id: sesion.id, estado: "subiendo" },
      data: {
        estado: "procesando",
        audioR2Key: key,
        duracionAudioSeg: parsed.data.duracionAudioSeg,
        error: null,
        // Sesión nueva para el lease de /pendientes.
        intentos: 0,
      },
    });
    if (count === 0) {
      throw new ApiError("La sesión cambió de estado durante la confirmación", 409);
    }

    const actualizada = await db.sesionClinica.findFirst({
      where: { id: sesion.id },
      select: SESION_SELECT,
    });
    if (!actualizada) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.subir_audio_fin",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: {
        ok: true,
        duracionAudioSeg: parsed.data.duracionAudioSeg,
        bytes,
      },
    });

    return ok(sinClaveTemporal(actualizada));
  } catch (error) {
    return errorResponse(error);
  }
}

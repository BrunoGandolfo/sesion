import { z } from "zod";
import { db } from "@/lib/db";

import { borrarAudioBestEffort } from "../../../_lib/audio";
import { getOrganizationId } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const notaSchema = z.object({
  subjetivo: z.string(),
  objetivo: z.string(),
  analisis: z.string(),
  plan: z.string(),
});

const aprobarSchema = z.object({
  notaEditada: notaSchema.optional(),
  notasEdicion: z.string().optional(),
});

// La aprobación cierra el ciclo de vida del audio (grabación → aprobación):
// la clave temporal de cifrado que upload guardó en
// datosEstructurados._audioCifradoTemporal no debe sobrevivir al audio.
// Devuelve el JSON re-serializado SIN la clave, o undefined si no hay nada
// que limpiar (datos ausentes, corruptos o ya sin clave) — undefined evita
// re-escribir y re-cifrar la columna al pedo.
function quitarClaveTemporal(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  if (!("_audioCifradoTemporal" in obj)) return undefined;
  const { _audioCifradoTemporal: _clave, ...resto } = obj;
  return JSON.stringify(resto);
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = aprobarSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existente = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        estado: true,
        audioR2Key: true,
        datosEstructurados: true,
      },
    });

    if (!existente) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    if (existente.estado !== "revision") {
      throw new ApiError(
        "Solo se pueden aprobar notas en estado revisión",
        400,
      );
    }

    // Fin del ciclo de vida del audio. Best-effort: si el borrado de R2
    // falla, la aprobación NO falla, pero audioR2Key se conserva — la key es
    // el único puntero al blob y nulearla lo dejaría huérfano e imborrable.
    // Si el borrado funciona, audioR2Key = null es la señal única de "audio
    // ya no existe" (más audioBorradoEn como auditoría; el campo ya existía
    // en el schema).
    const habiaAudio = Boolean(existente.audioR2Key);
    const audioBorrado = await borrarAudioBestEffort(existente.audioR2Key);

    // La clave temporal se elimina SIEMPRE al aprobar, incluso si el borrado
    // de R2 falló: sin la clave, el blob remanente es criptográficamente
    // inaccesible (crypto-shredding) y la key conservada permite borrarlo
    // en un intento posterior.
    const datosSinClave = quitarClaveTemporal(existente.datosEstructurados);

    const sesion = await db.sesionClinica.update({
      where: { id },
      data: {
        estado: "aprobado",
        aprobadoEn: new Date(),
        notasEdicion: parsed.data.notasEdicion,
        notaSubjetivo: parsed.data.notaEditada?.subjetivo,
        notaObjetivo: parsed.data.notaEditada?.objetivo,
        notaAnalisis: parsed.data.notaEditada?.analisis,
        notaPlan: parsed.data.notaEditada?.plan,
        ...(datosSinClave !== undefined
          ? { datosEstructurados: datosSinClave }
          : {}),
        ...(habiaAudio && audioBorrado
          ? { audioR2Key: null, audioBorradoEn: new Date() }
          : {}),
      },
    });

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}

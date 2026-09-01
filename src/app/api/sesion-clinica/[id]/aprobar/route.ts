import { z } from "zod";
import { db } from "@/lib/db";
import { normalizarRiesgo } from "@/types/domain";

import { borrarAudioBestEffort } from "../../../_lib/audio";
import { getOrganizationId } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";
import {
  assertTransicionValida,
  parseDatosEstructuradosRaw,
  sinClaveTemporal,
} from "../../../_lib/sesion-clinica";

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
  // Confirmación explícita de que la terapeuta revisó la señal de riesgo
  // graduada (riesgoDetectado nivel alto/moderado). Sin ella no se aprueba.
  confirmoRiesgo: z.boolean().optional(),
});

// Select de la fila que se devuelve tras aprobar. NUNCA transcripcion.
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

// La aprobación cierra el ciclo de vida del audio (grabación → aprobación):
// la clave temporal de cifrado que upload guardó en
// datosEstructurados._audioCifradoTemporal no debe sobrevivir al audio.
// Devuelve el JSON re-serializado SIN la clave, o undefined si no hay nada
// que limpiar (datos ausentes, corruptos o ya sin clave) — undefined evita
// re-escribir y re-cifrar la columna al pedo.
function quitarClaveTemporal(
  datos: Record<string, unknown> | null,
): string | undefined {
  if (!datos) return undefined;
  if (!("_audioCifradoTemporal" in datos)) return undefined;
  const { _audioCifradoTemporal: _clave, ...resto } = datos;
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
    assertTransicionValida(existente.estado, "aprobado");

    // Señal de riesgo graduada (contrato de riesgo clínico): con nivel alto o
    // moderado la aprobación exige confirmación explícita de revisión. Nunca
    // bloquea por sí sola — solo pide que la terapeuta declare que la vio.
    const datos = parseDatosEstructuradosRaw(existente.datosEstructurados);
    const riesgo = normalizarRiesgo(datos?.riesgoDetectado);
    const nivelExigeConfirmacion =
      riesgo.nivel === "alto" || riesgo.nivel === "moderado";
    if (nivelExigeConfirmacion && parsed.data.confirmoRiesgo !== true) {
      throw new ApiError(
        `La nota tiene una señal de riesgo (nivel ${riesgo.nivel}): confirmá que la revisaste antes de aprobar`,
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
    const datosSinClave = quitarClaveTemporal(datos);

    // Escritura condicionada al estado: si la sesión dejó de estar en
    // revisión entre la lectura y acá (descarte concurrente), no se pisa.
    // updateMany pasa por la extensión de cifrado igual que update.
    const { count } = await db.sesionClinica.updateMany({
      where: { id, estado: "revision" },
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

    if (count === 0) {
      throw new ApiError("La sesión ya no está en revisión", 409);
    }

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: SESION_SELECT,
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    return ok(sinClaveTemporal(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

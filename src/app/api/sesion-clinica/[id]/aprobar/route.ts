import { z } from "zod";
import { db } from "@/lib/db";
import { notaSoapSchema } from "@/lib/sesion-clinica/schema";
import { normalizarRiesgo } from "@/types/domain";

import { borrarAudioBestEffort } from "../../../_lib/audio";
import { hashTexto, registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";
import {
  assertTransicionValida,
  parseDatosEstructuradosRaw,
  SESION_SELECT,
  sinClaveTemporal,
  toSesionClinicaResponse,
} from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const aprobarSchema = z.object({
  // El cliente (NotaClinicaView) lo manda además de ponerlo en la URL. Se
  // acepta para no rechazar el body, pero la sesión se toma SIEMPRE de la
  // ruta: el valor del body se ignora.
  sesionClinicaId: z.string().optional(),
  notaEditada: notaSoapSchema.optional(),
  notasEdicion: z.string().optional(),
  // Confirmación explícita de que la terapeuta revisó la señal de riesgo
  // graduada (riesgoDetectado nivel alto/moderado). Sin ella no se aprueba.
  confirmoRiesgo: z.boolean().optional(),
});

// La aprobación cierra el ciclo de vida del audio (grabación → aprobación):
// la clave temporal de cifrado que upload-url guardó en
// datosEstructurados._audioCifradoTemporal no debe sobrevivir al audio.
// Devuelve el JSON re-serializado SIN la clave, o undefined si no hay nada
// que limpiar (datos ausentes, corruptos o ya sin clave) — undefined evita
// re-escribir y re-cifrar la columna al pedo.
function quitarClaveTemporal(
  datos: Record<string, unknown> | null,
): string | undefined {
  if (!datos) return undefined;
  if (!("_audioCifradoTemporal" in datos)) return undefined;
  return JSON.stringify(
    sinClaveTemporal({ datosEstructurados: datos }).datosEstructurados,
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const body: unknown = await request.json();
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

    // Solo el hash de la nota final: permite probar después que lo aprobado
    // es exactamente esto, sin copiar texto clínico al registro.
    const hashNotaAprobada = hashTexto(
      JSON.stringify({
        subjetivo: sesion.notaSubjetivo ?? null,
        objetivo: sesion.notaObjetivo ?? null,
        analisis: sesion.notaAnalisis ?? null,
        plan: sesion.notaPlan ?? null,
      }),
    );
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.aprobar",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: {
        confirmoRiesgo: parsed.data.confirmoRiesgo === true,
        nivelRiesgo: riesgo.nivel,
        notaEditada: parsed.data.notaEditada !== undefined,
        hashNotaAprobada,
        audioBorrado: habiaAudio && audioBorrado,
      },
    });

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

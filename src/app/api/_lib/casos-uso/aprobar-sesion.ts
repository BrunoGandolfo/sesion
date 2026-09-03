// Caso de uso: aprobar la nota de una sesión clínica en revisión.
//
// Recibe datos ya validados y sus dependencias (prisma, borrado de audio,
// auditoría); no lee `request` ni devuelve `Response`. Lanza ApiError con
// los mismos códigos y mensajes que el handler original.

import type { db } from "@/lib/db";
import type { NotaSoap } from "@/lib/sesion-clinica/schema";
import { normalizarRiesgo } from "@/types/domain";

import { hashTexto, type EventoAuditoriaInput } from "../auditoria-pura";
import { ApiError } from "../responses";
import {
  assertTransicionValida,
  parseDatosEstructuradosRaw,
  SESION_SELECT,
  sinClaveTemporal,
  type FilaSesionClinica,
} from "../sesion-clinica";

type ClientePrisma = typeof db;

export interface AprobarSesionInput {
  prisma: ClientePrisma;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  notaEditada?: NotaSoap;
  notasEdicion?: string;
  confirmoRiesgo?: boolean;
  /** Borrado best-effort del audio en R2: true si ya no queda audio. */
  borrarAudio: (audioR2Key: string | null) => Promise<boolean>;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

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

/** Devuelve la fila aprobada (con SESION_SELECT), lista para la respuesta. */
export async function aprobarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  notaEditada,
  notasEdicion,
  confirmoRiesgo,
  borrarAudio,
  registrarAuditoria,
}: AprobarSesionInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
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
    throw new ApiError("Solo se pueden aprobar notas en estado revisión", 400);
  }
  assertTransicionValida(existente.estado, "aprobado");

  // Señal de riesgo graduada (contrato de riesgo clínico): con nivel alto o
  // moderado la aprobación exige confirmación explícita de revisión. Nunca
  // bloquea por sí sola — solo pide que la terapeuta declare que la vio.
  const datos = parseDatosEstructuradosRaw(existente.datosEstructurados);
  const riesgo = normalizarRiesgo(datos?.riesgoDetectado);
  const nivelExigeConfirmacion =
    riesgo.nivel === "alto" || riesgo.nivel === "moderado";
  if (nivelExigeConfirmacion && confirmoRiesgo !== true) {
    throw new ApiError(
      `La nota tiene una señal de riesgo (nivel ${riesgo.nivel}): confirmá que la revisaste antes de aprobar`,
      400,
    );
  }

  // Fin del ciclo de vida del audio. Best-effort: si el borrado de R2
  // falla, la aprobación NO falla, pero audioR2Key se conserva — la key es
  // el único puntero al blob y nulearla lo dejaría huérfano e imborrable.
  // Si el borrado funciona, audioR2Key = null es la señal única de "audio
  // ya no existe" (más audioBorradoEn como auditoría).
  const habiaAudio = Boolean(existente.audioR2Key);
  const audioBorrado = await borrarAudio(existente.audioR2Key);

  // La clave temporal se elimina SIEMPRE al aprobar, incluso si el borrado
  // de R2 falló: sin la clave, el blob remanente es criptográficamente
  // inaccesible (crypto-shredding) y la key conservada permite borrarlo
  // en un intento posterior.
  const datosSinClave = quitarClaveTemporal(datos);

  // Escritura condicionada al estado: si la sesión dejó de estar en
  // revisión entre la lectura y acá (descarte concurrente), no se pisa.
  // updateMany pasa por la extensión de cifrado igual que update.
  const { count } = await prisma.sesionClinica.updateMany({
    where: { id: sesionId, estado: "revision" },
    data: {
      estado: "aprobado",
      aprobadoEn: new Date(),
      notasEdicion,
      notaSubjetivo: notaEditada?.subjetivo,
      notaObjetivo: notaEditada?.objetivo,
      notaAnalisis: notaEditada?.analisis,
      notaPlan: notaEditada?.plan,
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

  const sesion = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
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
    actorId: usuarioId,
    accion: "sesion.aprobar",
    entidad: "sesion_clinica",
    entidadId: sesion.id,
    detalle: {
      confirmoRiesgo: confirmoRiesgo === true,
      nivelRiesgo: riesgo.nivel,
      notaEditada: notaEditada !== undefined,
      hashNotaAprobada,
      audioBorrado: habiaAudio && audioBorrado,
    },
  });

  return sesion;
}

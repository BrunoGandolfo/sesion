// Caso de uso: persistir el resultado que entrega el worker (callback M2M).
//
// Recibe el payload ya validado y sus dependencias; no lee `request` ni
// devuelve `Response`. Lanza ApiError con los mismos códigos y mensajes que
// el handler original (404 sesión inexistente, 409 callback tardío).

import type { db } from "@/lib/db";
import { cifrarSesion } from "@/lib/prisma-encryption";
import type { DatosEstructurados, NotaSoap } from "@/lib/sesion-clinica/schema";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { ApiError } from "../responses";
import { extraerClaveTemporal } from "../sesion-clinica";

type ClientePrisma = typeof db;

/** Payload del callback, ya validado por el schema de la ruta. */
export interface PayloadCallback {
  sesionClinicaId: string;
  estado: "revision" | "error";
  transcripcion?: string;
  nota?: NotaSoap;
  datosEstructurados?: DatosEstructurados;
  modeloASR?: string;
  modeloLLM?: string;
  promptVersion?: string;
  error?: string;
}

export interface ProcesarCallbackInput {
  prisma: ClientePrisma;
  payload: PayloadCallback;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export async function procesarCallback({
  prisma,
  payload,
  registrarAuditoria,
}: ProcesarCallbackInput): Promise<void> {
  const sesion = await prisma.sesionClinica.findUnique({
    where: { id: payload.sesionClinicaId },
    select: {
      id: true,
      estado: true,
      intentos: true,
      organizationId: true,
      datosEstructurados: true,
      notaSoapOriginal: true,
    },
  });

  if (!sesion) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  const ahora = new Date();
  const esError = payload.estado === "error";

  // Re-adjuntar la clave temporal del audio al persistir el resultado.
  // La clave (upload-url la guarda en datosEstructurados._audioCifradoTemporal;
  // pendientes la lee para el worker) debe vivir exactamente lo que vive el
  // audio: hasta la aprobación de la nota o la eliminación definitiva. El
  // resultado del LLM no la trae y el schema Zod la descarta, así que se
  // re-adjunta desde la fila previa — sin esto, el audio en "revision"
  // queda vivo pero indescifrable y el reproceso tras un descarte es
  // imposible. En callbacks de error datosEstructurados viene undefined y
  // la columna no se toca, así que la clave ya sobrevive.
  const claveTemporal = payload.datosEstructurados
    ? extraerClaveTemporal(sesion.datosEstructurados)
    : null;

  // notaSoapOriginal se escribe UNA sola vez: la primera nota que llega del
  // worker. En un reproceso (descarte → error → procesando → callback) la
  // fila ya la tiene y NO se pisa: es el registro de "qué generó la IA"
  // antes de cualquier intervención humana.
  const escribirNotaOriginal =
    sesion.notaSoapOriginal === null && payload.nota !== undefined;

  const datosEstructurados = payload.datosEstructurados
    ? JSON.stringify(
        claveTemporal
          ? {
              ...payload.datosEstructurados,
              _audioCifradoTemporal: claveTemporal,
            }
          : payload.datosEstructurados,
      )
    : undefined;

  // Escritura condicionada al estado: solo se acepta el resultado si la
  // sesión sigue en "procesando". Un callback tardío (lease vencido y
  // re-entregado, sesión descartada/reintentada mientras tanto) no pisa
  // nada. Los campos clínicos van cifrados vía cifrarSesion; los que vienen
  // undefined no tocan su columna.
  const { count } = await prisma.sesionClinica.updateMany({
    where: { id: sesion.id, estado: "procesando" },
    data: {
      estado: payload.estado,
      // Convención del worker: la terapeuta es siempre el hablante S0.
      ...(payload.nota ? { hablanteTerapeuta: "S0" } : {}),
      modeloASR: payload.modeloASR,
      modeloLLM: payload.modeloLLM,
      promptVersion: payload.promptVersion,
      procesadoEn: ahora,
      error: esError ? payload.error ?? null : null,
      intentos: esError ? sesion.intentos + 1 : undefined,
      ...cifrarSesion({
        transcripcion: payload.transcripcion,
        notaSubjetivo: payload.nota?.subjetivo,
        notaObjetivo: payload.nota?.objetivo,
        notaAnalisis: payload.nota?.analisis,
        notaPlan: payload.nota?.plan,
        notaSoapOriginal: escribirNotaOriginal ? payload.nota : undefined,
        datosEstructurados,
      }),
    },
  });

  if (count === 0) {
    throw new ApiError(
      "La sesión no está en procesamiento; callback ignorado",
      409,
    );
  }

  const intentoPipeline = payload.datosEstructurados?._pipeline?.intento;
  await registrarAuditoria({
    organizationId: sesion.organizationId,
    actorTipo: "worker",
    actorId: null,
    accion: "sesion.callback",
    entidad: "sesion_clinica",
    entidadId: sesion.id,
    detalle: {
      estadoResultado: payload.estado,
      promptVersion: payload.promptVersion ?? null,
      modeloASR: payload.modeloASR ?? null,
      modeloLLM: payload.modeloLLM ?? null,
      rolesOrigen: payload.datosEstructurados?.speechAnalytics?.rolesOrigen ?? null,
      ...(typeof intentoPipeline === "number" ||
      typeof intentoPipeline === "string"
        ? { intento: intentoPipeline }
        : {}),
      nivelRiesgo: payload.datosEstructurados?.riesgoDetectado?.nivel ?? null,
      huboError: esError,
    },
  });
}

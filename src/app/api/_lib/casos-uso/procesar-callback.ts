// Caso de uso: persistir el resultado que entrega el worker (callback M2M).
//
// Recibe el payload ya validado y sus dependencias; no lee `request` ni
// devuelve `Response`. Lanza ApiError con los mismos códigos y mensajes que
// el handler original (404 sesión inexistente, 409 callback tardío).

import type { db } from "@/lib/db";
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

// Fila previa que necesita el callback. `notaSoapOriginal` es un campo
// lógico de la extensión de cifrado (sin columna legacy): vive en una const
// y no en un literal inline para que TS no lo rechace como propiedad
// sobrante del tipo generado; la extensión lo traduce a la columna cifrada.
const SESION_PREVIA_SELECT = {
  id: true,
  estado: true,
  intentos: true,
  organizationId: true,
  datosEstructurados: true,
  notaSoapOriginal: true,
} as const;

export async function procesarCallback({
  prisma,
  payload,
  registrarAuditoria,
}: ProcesarCallbackInput): Promise<void> {
  const sesion = await prisma.sesionClinica.findUnique({
    where: { id: payload.sesionClinicaId },
    select: SESION_PREVIA_SELECT,
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
  // antes de cualquier intervención humana. El tipo generado por Prisma no
  // conoce el campo lógico; el narrowing con `in` lo expone sin cast.
  const notaOriginalPrevia =
    "notaSoapOriginal" in sesion ? sesion.notaSoapOriginal : null;
  const escribirNotaOriginal =
    notaOriginalPrevia == null && payload.nota !== undefined;

  // Objeto NO literal en la llamada: TS solo aplica el chequeo de
  // propiedades sobrantes a literales frescos, y notaSoapOriginal no existe
  // en el tipo generado (la extensión la consume antes de llegar a Prisma).
  const data = {
    estado: payload.estado,
    transcripcion: payload.transcripcion,
    notaSubjetivo: payload.nota?.subjetivo,
    notaObjetivo: payload.nota?.objetivo,
    notaAnalisis: payload.nota?.analisis,
    notaPlan: payload.nota?.plan,
    ...(escribirNotaOriginal ? { notaSoapOriginal: payload.nota } : {}),
    // Convención del worker: la terapeuta es siempre el hablante S0.
    ...(payload.nota ? { hablanteTerapeuta: "S0" } : {}),
    datosEstructurados: payload.datosEstructurados
      ? JSON.stringify(
          claveTemporal
            ? {
                ...payload.datosEstructurados,
                _audioCifradoTemporal: claveTemporal,
              }
            : payload.datosEstructurados,
        )
      : undefined,
    modeloASR: payload.modeloASR,
    modeloLLM: payload.modeloLLM,
    promptVersion: payload.promptVersion,
    procesadoEn: ahora,
    error: esError ? payload.error ?? null : null,
    intentos: esError ? sesion.intentos + 1 : undefined,
  };

  // Escritura condicionada al estado: solo se acepta el resultado si la
  // sesión sigue en "procesando". Un callback tardío (lease vencido y
  // re-entregado, sesión descartada/reintentada mientras tanto) no pisa
  // nada. updateMany pasa por la extensión de cifrado igual que update.
  const { count } = await prisma.sesionClinica.updateMany({
    where: { id: sesion.id, estado: "procesando" },
    data,
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

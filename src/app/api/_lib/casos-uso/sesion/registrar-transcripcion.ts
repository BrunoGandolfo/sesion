// Checkpoint: la transcripción se guarda apenas existe, antes de la primera
// llamada al modelo. Desde acá, ningún reintento (fallo del modelo, reproceso,
// reintento manual) vuelve a transcribir: el reclamo siguiente la entrega
// hecha. Idempotente: el mismo intento puede repetirlo y sólo reescribe.
//
// `modeloAsr` va en el mismo UPDATE que la transcripción: es la señal de
// "hay transcripción" que usan la respuesta a la UI y las precondiciones.

import type { SpeechAnalytics } from "@/lib/sesion-clinica/schema";

import type { EventoAuditoriaInput } from "../../auditoria-pura";

import { cifrarSesion } from "./cifrado";
import { transicionar, type ClienteSesion } from "./transicion";

export interface RegistrarTranscripcionInput {
  prisma: ClienteSesion;
  sesionId: string;
  organizationId: string;
  intento: number;
  transcripcion: string;
  speechAnalytics?: SpeechAnalytics;
  modeloAsr: string;
  duracionSeg?: number;
  asrTranscriptId?: string;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export async function registrarTranscripcion({
  prisma,
  sesionId,
  organizationId,
  intento,
  transcripcion,
  speechAnalytics,
  modeloAsr,
  duracionSeg,
  asrTranscriptId,
  registrarAuditoria,
}: RegistrarTranscripcionInput): Promise<void> {
  await transicionar({
    prisma,
    operacion: "registrar_transcripcion",
    sesionId,
    organizationId,
    intento,
    data: {
      modeloAsr,
      ...(speechAnalytics !== undefined ? { speechAnalytics } : {}),
      ...(duracionSeg !== undefined ? { duracionAudioSeg: duracionSeg } : {}),
      ...(asrTranscriptId !== undefined ? { asrTranscriptId } : {}),
      ...cifrarSesion(sesionId, { transcripcion }),
    },
  });

  await registrarAuditoria({
    organizationId,
    actorTipo: "worker",
    actorId: null,
    accion: "sesion.transcripcion_guardada",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: {
      intento,
      modeloAsr,
      caracteres: transcripcion.length,
      rolesOrigen: speechAnalytics?.rolesOrigen ?? null,
    },
  });
}

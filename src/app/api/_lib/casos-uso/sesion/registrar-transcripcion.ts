// Checkpoint: la transcripción se guarda apenas existe, antes de la primera
// llamada al modelo. Desde acá, ningún reintento (fallo del modelo, reproceso,
// reintento manual) vuelve a transcribir: el reclamo siguiente la entrega
// hecha. Idempotente: el mismo intento puede repetirlo y sólo reescribe.
//
// `modeloAsr` va en el mismo UPDATE que la transcripción: es la señal de
// "hay transcripción" que usan la respuesta a la UI y las precondiciones.
//
// `duracionSeg` es la duración que informa el proveedor del ASR. NO pisa
// `duracionAudioSeg`, que es lo que midió el teléfono contando chunks: son dos
// medidas de cosas distintas, y cuando difieren esa diferencia es el dato (un
// archivo que el decodificador leyó más corto que lo grabado). Queda en el
// detalle de la auditoría, al lado de la del teléfono.

import type { SpeechAnalytics } from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../auditoria";

import { cifrarSesion } from "@/lib/prisma-encryption";
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
      ...(asrTranscriptId !== undefined ? { asrTranscriptId } : {}),
      ...cifrarSesion(sesionId, { transcripcion }),
    },
  });

  await registrarAuditoria(prisma, {
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
      duracionAsrSeg: duracionSeg ?? null,
      rolesOrigen: speechAnalytics?.rolesOrigen ?? null,
    },
  });
}

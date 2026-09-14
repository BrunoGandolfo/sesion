// Entrega de trabajos al worker: reclamo más el adjunto que cada tipo
// necesita, descifrado, por TLS, sin persistir nada en `trabajos`.
//
//   generar_feedback   → { transcripcionFormateada, speechAnalytics,
//                          orientacionTeorica }
//   borrar_transcript_asr → nada (el payload ya trae el transcriptId)
//   integrar_contexto  → lo define el Área 4 (hilo): acá va `null`; ver
//                        ADJUNTOS para engancharlo sin tocar este archivo.

import type { Prisma, TipoTrabajo } from "@prisma/client";

import type { db } from "@/lib/db";

import { descifrarCampo } from "../sesion/cifrado";

import { reclamarTrabajos, type TrabajoReclamado } from "./reclamar";

type ClienteEntrega = Pick<typeof db, "trabajo" | "hiloVersion" | "sesionClinica" | "configuracion">;

/** Arma el adjunto de un tipo; null si no hay nada que adjuntar. */
export type Adjuntador = (
  prisma: ClienteEntrega,
  trabajo: TrabajoReclamado,
) => Promise<unknown>;

const ORIENTACION_DEFAULT = "cbt_mi";

async function adjuntoFeedback(prisma: ClienteEntrega, trabajo: TrabajoReclamado): Promise<unknown> {
  if (!trabajo.sesionId) return null;
  const sesion = await prisma.sesionClinica.findUnique({
    where: { id: trabajo.sesionId },
    select: {
      id: true,
      speechAnalytics: true,
      transcripcionEncrypted: true,
      organization: { select: { configuracion: { select: { orientacionTeorica: true } } } },
    },
  });
  if (!sesion) return null;
  const transcripcion = descifrarCampo(sesion.id, "transcripcion", sesion.transcripcionEncrypted);
  if (!transcripcion) return null;
  return {
    transcripcionFormateada: transcripcion,
    speechAnalytics: sesion.speechAnalytics,
    orientacionTeorica:
      sesion.organization.configuracion?.orientacionTeorica ?? ORIENTACION_DEFAULT,
  };
}

/** Un adjuntador por tipo. El Área 4 registra el de integrar_contexto. */
export const ADJUNTOS: Partial<Record<TipoTrabajo, Adjuntador>> = {
  generar_feedback: adjuntoFeedback,
};

export interface TrabajoEntregado {
  trabajoId: string;
  tipo: TipoTrabajo;
  intentos: number;
  ticket: string;
  payload: Prisma.JsonValue;
  adjunto: unknown;
}

export interface EntregarTrabajosInput {
  prisma: ClienteEntrega;
  ahora: Date;
  limite: number;
  tipos?: ReadonlyArray<TipoTrabajo>;
  adjuntos?: Partial<Record<TipoTrabajo, Adjuntador>>;
}

export async function entregarTrabajos({
  prisma,
  ahora,
  limite,
  tipos,
  adjuntos = ADJUNTOS,
}: EntregarTrabajosInput): Promise<TrabajoEntregado[]> {
  const reclamados = await reclamarTrabajos({ prisma, ejecutor: "worker", ahora, limite, tipos });
  const entregados: TrabajoEntregado[] = [];
  for (const t of reclamados) {
    const adjuntar = adjuntos[t.tipo];
    entregados.push({
      trabajoId: t.id,
      tipo: t.tipo,
      intentos: t.intentos,
      // reclamarTrabajos siempre emite ticket para el worker.
      ticket: t.ticket ?? "",
      payload: t.payload,
      adjunto: adjuntar ? await adjuntar(prisma, t) : null,
    });
  }
  return entregados;
}

// Anotar un trabajo durable: lo que hay que hacer afuera de la base, para
// hacerlo después y reintentar si falla.
//
// Se llama SIEMPRE dentro de la transacción de la operación que lo motiva
// (aprobar, eliminar, resultado, pedir feedback): o quedan las dos
// escrituras, o ninguna. El payload nunca lleva contenido clínico; lo
// clínico que el worker necesita se adjunta descifrado al entregarlo.

import type { Prisma, EjecutorTrabajo, TipoTrabajo } from "@prisma/client";

import type { db } from "@/lib/db";

/** Payload por tipo. Es lo que se persiste en `trabajos.payload`. */
export type PayloadTrabajo =
  | {
      tipo: "borrar_audio_r2";
      payload: { prefijo: string; indices: number[] };
    }
  | { tipo: "borrar_transcript_asr"; payload: { transcriptId: string } }
  | {
      tipo: "generar_feedback";
      /** `generacion`: la nota para la que se pidió. Un resultado de un
       *  trabajo viejo no puede marcar el feedback de una generación nueva. */
      payload: { sesionId: string; pacienteId: string; generacion: number };
    }
  | {
      tipo: "integrar_contexto";
      payload: { sesionId: string; pacienteId: string };
    };

/** Quién lo consume: la app tiene las credenciales de R2; sólo el worker
 *  tiene las de AssemblyAI y Anthropic. */
export const EJECUTOR_DE_TIPO: Record<TipoTrabajo, EjecutorTrabajo> = {
  borrar_audio_r2: "app",
  borrar_transcript_asr: "worker",
  generar_feedback: "worker",
  integrar_contexto: "worker",
};

export type CrearTrabajoInput = PayloadTrabajo & {
  prisma: Pick<typeof db, "trabajo">;
  organizationId: string;
  /** Sin FK: la sesión puede borrarse y el trabajo se completa igual. */
  sesionId?: string | null;
  /** Para la regla de encadenado de integrar_contexto. */
  pacienteId?: string | null;
  /** Por defecto ahora. */
  proximoIntentoEn?: Date;
};

export async function crearTrabajo(input: CrearTrabajoInput): Promise<{ id: string }> {
  const trabajo = await input.prisma.trabajo.create({
    data: {
      tipo: input.tipo,
      ejecutor: EJECUTOR_DE_TIPO[input.tipo],
      organizationId: input.organizationId,
      sesionId: input.sesionId ?? null,
      pacienteId: input.pacienteId ?? null,
      payload: input.payload as Prisma.InputJsonObject,
      ...(input.proximoIntentoEn
        ? { proximoIntentoEn: input.proximoIntentoEn }
        : {}),
    },
    select: { id: true },
  });
  return trabajo;
}

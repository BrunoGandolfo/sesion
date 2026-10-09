// Las herramientas de Lux: lista cerrada, sólo lectura. Hoy una.
//
// leer_transcripcion(sesionId): el id tiene que estar en la lista (e) del
// material, que armó el servidor para ESTE paciente de ESTA organización. Un
// id fuera de la lista se rechaza sin tocar la base: el modelo nunca elige
// organización, paciente, columnas ni SQL. La lectura y su rastro
// (sesion.ver_transcripcion, via "lux") van en una transacción, como cuando
// ella la abre en la pantalla.

import { z } from "zod";

import type { EjecutorHerramientas, PedidoConversacion } from "@/lib/anthropic-mensajes";

import { auditarLecturaTranscripcion } from "../sesion/ver-transcripcion";
import {
  CARACTERES_POR_TOKEN, diaMes, escapar, fechaLegible, TOKENS_MAX_MATERIAL, type ClienteLux,
} from "./material";

export const HERRAMIENTA_LEER_TRANSCRIPCION = "leer_transcripcion";

export const leerTranscripcionSchema = z.object({ sesionId: z.string().uuid() }).strict();

export const HERRAMIENTAS_LUX: PedidoConversacion["tools"] = [{
  name: HERRAMIENTA_LEER_TRANSCRIPCION,
  description: "Lee la transcripción completa de UNA sesión anterior de este paciente. Sólo acepta un id de la lista \"Sesiones anteriores que podés abrir con leer_transcripcion\" del material; cualquier otro se rechaza. Devuelve la transcripción con su fecha (S0 es la terapeuta). Usala sólo cuando la pregunta o tu observación necesitan el detalle de esa sesión, no por curiosidad. No escribe nada.",
  input_schema: {
    type: "object",
    properties: { sesionId: { type: "string", description: "El id tal como figura en la lista de sesiones anteriores." } },
    required: ["sesionId"],
    additionalProperties: false,
  },
}];

export const RECHAZO_FUERA_DE_LISTA =
  "Esa sesión no está en la lista de sesiones anteriores de este paciente. Sólo podés abrir las de esa lista.";
export const RECHAZO_HERRAMIENTA = "Esa herramienta no existe. La única es leer_transcripcion.";
export const RECHAZO_SIN_TRANSCRIPCION = "Esa sesión no tiene transcripción.";
export const RECHAZO_DEMASIADO_LARGA =
  "Esa transcripción es demasiado larga para leerla entera acá. Trabajá con la nota de esa sesión.";

export interface EjecutorLux extends EjecutorHerramientas {
  /** Las sesiones efectivamente leídas por la herramienta, en orden. */
  leidas: string[];
}

export function ejecutorLux(contexto: {
  prisma: ClienteLux;
  organizationId: string;
  usuarioId: string;
  abribles: ReadonlyMap<string, Date>;
}): EjecutorLux {
  const leidas: string[] = [];
  const validar = (nombre: string, entrada: unknown) => {
    if (nombre !== HERRAMIENTA_LEER_TRANSCRIPCION) return null;
    const parsed = leerTranscripcionSchema.safeParse(entrada);
    if (!parsed.success || !contexto.abribles.has(parsed.data.sesionId)) return null;
    return { sesionId: parsed.data.sesionId, fecha: contexto.abribles.get(parsed.data.sesionId)! };
  };

  return {
    leidas,
    aviso({ nombre, entrada }) {
      const valida = validar(nombre, entrada);
      return valida ? `_(mirando la transcripción del ${diaMes(valida.fecha)})_` : null;
    },
    async ejecutar({ nombre, entrada }) {
      if (nombre !== HERRAMIENTA_LEER_TRANSCRIPCION) return { contenido: RECHAZO_HERRAMIENTA, esError: true };
      const valida = validar(nombre, entrada);
      if (!valida) return { contenido: RECHAZO_FUERA_DE_LISTA, esError: true };
      // Lectura, medida y rastro en una transacción. Una transcripción
      // demasiado larga no llega al modelo, así que no se audita como leída.
      const transcripcion = await contexto.prisma.$transaction(async (tx) => {
        const fila = await tx.sesionClinica.findFirst({
          where: { id: valida.sesionId, organizationId: contexto.organizationId },
          select: { id: true, estado: true, transcripcion: true },
        });
        if (!fila?.transcripcion) return { rechazo: RECHAZO_SIN_TRANSCRIPCION };
        if (fila.transcripcion.length > TOKENS_MAX_MATERIAL * CARACTERES_POR_TOKEN) return { rechazo: RECHAZO_DEMASIADO_LARGA };
        await auditarLecturaTranscripcion(tx, {
          organizationId: contexto.organizationId, usuarioId: contexto.usuarioId, sesionId: fila.id,
          estado: fila.estado, caracteres: fila.transcripcion.length, via: "lux",
        });
        return { texto: fila.transcripcion };
      });
      if ("rechazo" in transcripcion) return { contenido: transcripcion.rechazo!, esError: true };
      leidas.push(valida.sesionId);
      return {
        contenido: `Transcripción de la sesión del ${fechaLegible(valida.fecha)} (S0 es la terapeuta):\n${escapar(transcripcion.texto)}`,
      };
    },
  };
}

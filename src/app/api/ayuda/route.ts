// POST /api/ayuda — una pregunta, una respuesta.
//
// La ruta hace lo suyo: autenticar, validar, aplicar el tope diario, llamar
// al caso de uso y auditar. La decisión de qué contestar está en
// ../_lib/casos-uso/responder-ayuda.ts.
//
// QUÉ SE AUDITA
//
// Metadatos y nada más: cuántos caracteres tenía la pregunta, cuántos la
// respuesta, cuántos tokens, qué modelo, cuánto se leyó del caché. NUNCA el
// texto de la pregunta ni el de la respuesta. Dos motivos: una pregunta de
// ayuda puede llevar adentro el nombre de una paciente ("no me sale la nota
// de X"), y el registro de auditoría existe para saber que algo pasó, no qué
// decía. detalleSeguro además tira las claves de la lista negra, pero la
// primera línea de defensa es no mandarlo.
//
// El evento que se escribe acá es también el que cuenta el tope diario: una
// fila por pregunta contestada. Ver contarPreguntasDelDia.

import { z } from "zod";
import { MODELO_AYUDA } from "@/lib/anthropic-mensajes";
import { limpiarMarkdown, type EstadoMarkdown } from "@/lib/ayuda-texto";
import { db } from "@/lib/db";

import { registrarAuditoria } from "../_lib/auditoria";
import { getSessionActor } from "../_lib/auth";
import {
  ACCION_AYUDA,
  assertBajoElTope,
  ENTIDAD_AYUDA,
  LARGO_MAX_PREGUNTA,
  MAX_TURNOS_HISTORIAL,
  responderAyudaStreaming,
} from "../_lib/casos-uso/responder-ayuda";
import { errorResponse, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const turnoSchema = z.object({
  rol: z.enum(["usuaria", "asistente"]),
  texto: z.string().trim().min(1).max(4000),
});

const preguntaSchema = z.object({
  pregunta: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA),
  // El recorte a los últimos MAX_TURNOS_HISTORIAL lo hace el caso de uso;
  // acá el tope es contra un cuerpo enorme, por eso es holgado.
  historial: z.array(turnoSchema).max(MAX_TURNOS_HISTORIAL * 2).optional(),
});

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();

    const body: unknown = await request.json();
    const parsed = preguntaSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // Antes de gastar una llamada al proveedor.
    await assertBajoElTope(db, { organizationId, userId });

    const flujo = await responderAyudaStreaming({
      pregunta: parsed.data.pregunta,
      historial: parsed.data.historial,
    });
    const codificador = new TextEncoder();
    const cuerpo = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let estado: EstadoMarkdown = { pendiente: "", linea: "inicio" };
          for await (const fragmento of flujo.fragmentos) {
            const limpio = limpiarMarkdown(fragmento, estado);
            estado = limpio.estado;
            if (limpio.texto) controller.enqueue(codificador.encode(limpio.texto));
          }
          const cierre = limpiarMarkdown("", estado, true);
          if (cierre.texto) controller.enqueue(codificador.encode(cierre.texto));
          const resultado = await flujo.resultado;
          const textoCompleto = limpiarMarkdown(resultado.texto);
          // La pregunta sólo consume cuota cuando Anthropic cerró un mensaje
          // completo. El stream HTTP tampoco cierra antes de dejar este rastro.
          await registrarAuditoria({
            organizationId,
            actorTipo: "usuario",
            actorId: userId,
            accion: ACCION_AYUDA,
            entidad: ENTIDAD_AYUDA,
            entidadId: userId,
            detalle: {
              largoPregunta: parsed.data.pregunta.length,
              largoRespuesta: textoCompleto.length,
              turnosHistorial: parsed.data.historial?.length ?? 0,
              modelo: MODELO_AYUDA,
              tokensEntrada: resultado.tokensEntrada,
              tokensSalida: resultado.tokensSalida,
              cacheLeido: resultado.cacheLeido,
            },
          });
          controller.close();
        } catch (error) {
          console.error("[ayuda] stream interrumpido", error);
          controller.error(error);
        }
      },
      cancel() {
        flujo.cancelar();
      },
    });

    return new Response(cuerpo, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

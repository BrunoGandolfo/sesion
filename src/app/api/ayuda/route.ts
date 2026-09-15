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
// El cupo se reserva antes del proveedor; la auditoría no decide el límite.

import { z } from "zod";
import { MODELO_AYUDA } from "@/lib/anthropic-mensajes";
import { limpiarMarkdown, type EstadoMarkdown } from "@/lib/ayuda-texto";
import { db } from "@/lib/db";

import { registrarAuditoria } from "../_lib/auditoria";
import { getSessionActor } from "../_lib/auth";
import {
  ACCION_AYUDA,
  ENTIDAD_AYUDA,
  LARGO_MAX_PREGUNTA,
  MAX_TURNOS_HISTORIAL,
  responderAyudaStreaming,
} from "../_lib/casos-uso/responder-ayuda";
import { reservarCupo, devolverCupo } from "../_lib/casos-uso/ayuda/reservar-cupo";
import { errorResponse, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

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
    const reserva = await reservarCupo(db, userId);
    let flujo: Awaited<ReturnType<typeof responderAyudaStreaming>>;
    try {
      flujo = await responderAyudaStreaming({ pregunta: parsed.data.pregunta, historial: parsed.data.historial });
    } catch (error) {
      await devolverCupo(db, reserva);
      throw error;
    }
    const codificador = new TextEncoder();
    let recibioFragmento = false;
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let estado: EstadoMarkdown = { pendiente: "", linea: "inicio" };
          for await (const fragmento of flujo.fragmentos) {
            if (fragmento.length) recibioFragmento = true;
            if (cancelado) return;
            const limpio = limpiarMarkdown(fragmento, estado);
            estado = limpio.estado;
            if (limpio.texto) controller.enqueue(codificador.encode(limpio.texto));
          }
          const cierre = limpiarMarkdown("", estado, true);
          if (cierre.texto) controller.enqueue(codificador.encode(cierre.texto));
          const resultado = await flujo.resultado;
          const textoCompleto = limpiarMarkdown(resultado.texto);
          // El stream cierra después del rastro; el cupo ya quedó reservado.
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
          if (!recibioFragmento && !cancelado) await devolverCupo(db, reserva);
          console.error("[ayuda] stream interrumpido");
          if (cancelado) return;
          controller.error(error);
        }
      },
      cancel() {
        cancelado = true;
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

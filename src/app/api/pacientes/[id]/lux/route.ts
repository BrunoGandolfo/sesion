// POST /api/pacientes/[id]/lux — conversar con Lux sobre un paciente.
//
// Sin `pregunta` y sin `historial`: apertura (Lux habla primero). Con
// `pregunta`: respuesta, con el historial que manda la pantalla (las charlas
// no se guardan en ningún lado). Mismo transporte que /api/ayuda: text/plain
// en streaming. Contrato completo en docs/contrato-lux.md.
//
// La ruta valida, autoriza, reserva el cupo de Lux, llama al caso de uso y,
// cuando el stream terminó, le pide que deje el rastro. Qué se lee, qué se
// audita y qué se le manda al modelo está en ../../../_lib/casos-uso/lux/.
//
// A diferencia de /api/ayuda, el texto NO pasa por limpiarMarkdown: el bloque
// <citas> y el aviso _(mirando la transcripción del DD/MM)_ son para la
// pantalla, que los pliega y los muestra.

import { z } from "zod";

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { devolverCupo, reservarCupo } from "../../../_lib/casos-uso/ayuda/reservar-cupo";
import {
  abrirConversacion,
  autorizarPaciente,
  LARGO_MAX_PREGUNTA_LUX,
  LARGO_MAX_TURNO_LUX,
  MAX_TURNOS_HISTORIAL,
  registrarConversacionLux,
  responder,
  type ConversacionLux,
} from "../../../_lib/casos-uso/lux/conversar";
import { errorResponse, leerJson, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

// Lo que ella escribió tiene el tope de una pregunta; lo que contestó Lux
// tiene que poder volver entero (LARGO_MAX_TURNO_LUX, en conversar.ts).
const turnoSchema = z.discriminatedUnion("rol", [
  z.object({ rol: z.literal("usuaria"), texto: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA_LUX) }),
  z.object({ rol: z.literal("asistente"), texto: z.string().trim().min(1).max(LARGO_MAX_TURNO_LUX) }),
]);

const cuerpoSchema = z.object({
  pregunta: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA_LUX).optional(),
  // El recorte a los últimos MAX_TURNOS_HISTORIAL lo hace el caso de uso.
  historial: z.array(turnoSchema).max(MAX_TURNOS_HISTORIAL * 2).optional(),
}).strict().refine(
  (cuerpo) => cuerpo.pregunta !== undefined || !cuerpo.historial?.length,
  { message: "Con historial hace falta una pregunta", path: ["pregunta"] },
);

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id: pacienteId } = await params;

    const body: unknown = await leerJson(request);
    const parsed = cuerpoSchema.safeParse(body ?? {});
    if (!parsed.success) return validationError(parsed.error);
    const { pregunta, historial } = parsed.data;
    const tipo = pregunta === undefined ? "abrir" : "pregunta";

    await autorizarPaciente(db, organizationId, pacienteId);
    const reserva = await reservarCupo(db, userId, new Date(), "lux");
    let conversacion: ConversacionLux;
    try {
      const base = { prisma: db, organizationId, usuarioId: userId, pacienteId };
      conversacion = pregunta === undefined
        ? await abrirConversacion(base)
        : await responder({ ...base, pregunta, historial });
    } catch (error) {
      await devolverCupo(db, reserva);
      throw error;
    }

    const { flujo } = conversacion;
    const codificador = new TextEncoder();
    let recibioFragmento = false;
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const fragmento of flujo.fragmentos) {
            if (fragmento.length) recibioFragmento = true;
            if (cancelado) return;
            controller.enqueue(codificador.encode(fragmento));
          }
          const resultado = await flujo.resultado;
          await registrarConversacionLux({
            prisma: db, organizationId, userId, pacienteId, tipo, conversacion, resultado,
            largoPregunta: pregunta?.length ?? 0,
            largoRespuesta: resultado.texto.length,
            turnosHistorial: historial?.length ?? 0,
          });
          controller.close();
        } catch (error) {
          if (!recibioFragmento && !cancelado) await devolverCupo(db, reserva);
          // Sin el error: su mensaje puede traer el cuerpo del proveedor.
          console.error("[lux] stream interrumpido");
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

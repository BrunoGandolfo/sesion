// POST /api/pacientes/[id]/lux — conversar con Lux sobre un paciente.
//
// Sin `pregunta` y sin `historial`: apertura (Lux habla primero). Con
// `pregunta`: respuesta, con el historial que manda la pantalla (las charlas
// no se guardan en ningún lado). Mismo transporte que /api/ayuda: text/plain
// en streaming. Contrato completo en docs/contrato-lux.md.
//
// La ruta valida, autoriza, reserva el cupo de Lux, llama al caso de uso y,
// cuando el stream terminó (entero, cancelado o cortado), le pide que deje el
// rastro.
//
// El cupo vuelve sólo si el proveedor no llegó a recibir el pedido: un error
// de base o de validación en el caso de uso, antes de llamarlo. Desde que se
// llamó a Anthropic puede haber cobrado (un timeout, una respuesta sin texto,
// una herramienta que falla después de la primera ronda): el cupo se queda. Qué se lee, qué se
// audita y qué se le manda al modelo está en ../../../_lib/casos-uso/lux/.
//
// A diferencia de /api/ayuda, el texto NO pasa por limpiarMarkdown: el bloque
// <citas> y el aviso _(mirando la transcripción del DD/MM)_ son para la
// pantalla, que los pliega y los muestra.

import { db } from "@/lib/db";
import { peticionLuxSchema } from "@/lib/lux/contrato";

import { getSessionActor } from "../../../_lib/auth";
import { devolverCupo, reservarCupo } from "../../../_lib/casos-uso/ayuda/reservar-cupo";
import {
  abrirConversacion,
  autorizarPaciente,
  ErrorProveedorLux,
  registrarConversacionLux,
  responder,
  type ConversacionLux,
} from "../../../_lib/casos-uso/lux/conversar";
import { errorResponse, leerJson, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id: pacienteId } = await params;

    const body: unknown = await leerJson(request);
    const parsed = peticionLuxSchema.safeParse(body ?? {});
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
      if (!(error instanceof ErrorProveedorLux)) await devolverCupo(db, reserva);
      throw error;
    }

    const { flujo } = conversacion;
    const codificador = new TextEncoder();
    let cancelado = false;
    let registrado = false;
    let largoEnviado = 0;
    const registrar = (resultado: Parameters<typeof registrarConversacionLux>[0]["resultado"], largoRespuesta: number, interrumpida: boolean) => {
      registrado = true;
      return registrarConversacionLux({
        prisma: db, organizationId, userId, pacienteId, tipo, conversacion, resultado,
        largoPregunta: pregunta?.length ?? 0,
        largoRespuesta,
        turnosHistorial: historial?.length ?? 0,
        interrumpida,
      });
    };
    // Cancelada o cortada: el rastro igual queda, con lo que se sabe. Si
    // falla, se dice en el log y nada más (ya no hay a quién contestarle).
    const registrarInterrumpida = async () => {
      if (registrado) return;
      try {
        await registrar(flujo.progreso(), largoEnviado, true);
      } catch {
        console.error("[lux] no se pudo registrar la conversación interrumpida");
      }
    };
    const cuerpo = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const fragmento of flujo.fragmentos) {
            if (cancelado) return await registrarInterrumpida();
            largoEnviado += fragmento.length;
            controller.enqueue(codificador.encode(fragmento));
          }
          const resultado = await flujo.resultado;
          await registrar(resultado, resultado.texto.length, false);
          controller.close();
        } catch (error) {
          await registrarInterrumpida();
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

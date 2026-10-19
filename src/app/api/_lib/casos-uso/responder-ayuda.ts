// Caso de uso: contestar una pregunta de ayuda.
//
// Recibe la pregunta y el historial ya parseados, arma la llamada a Anthropic
// y devuelve la respuesta con sus métricas. No lee `request`, no devuelve
// `Response`. La única lectura se inyecta como consultarAgenda, ligada a la
// organización autenticada; el cupo se reserva aparte en reservar-cupo.ts.
//
// LO QUE NUNCA SALE DE ACÁ
//
// Un fallo del proveedor —clave inválida, 500 de Anthropic, timeout— se
// loguea con detalle y se traduce a un ErrorProveedorAsistente (502) con
// texto para la usuaria y la regla del cupo (ayuda/reservar-cupo.ts).
// El mensaje de ErrorAnthropic trae el cuerpo del proveedor y no se pasa
// nunca a la respuesta HTTP.
//
// Runtime nodejs: importa el corpus, que lee del disco.

import {
  crearMensajeStreaming,
  diagnosticoDe,
  ErrorAnthropic,
  esErrorHttpDelProveedor,
  MODELO_AYUDA,
  systemCacheado,
  type MensajeAnthropic,
  type ResultadoMensajes,
  type FlujoMensajes,
} from "@/lib/anthropic-mensajes";
import { ACCIONES } from "@/lib/auditoria-acciones";
import { LARGO_MAX_PREGUNTA, MAX_TURNOS_HISTORIAL } from "@/lib/ayuda-contrato";
import { systemPromptAyuda } from "@/lib/ayuda-corpus";

import { registrarAuditoria, type ClienteAuditoria } from "../auditoria";
import { ApiError } from "../responses";
import { ErrorProveedorAsistente } from "./ayuda/reservar-cupo";
import { HERRAMIENTAS_AYUDA, resolverHerramienta, type ConsultarAgenda } from "./ayuda/herramientas";


/** Techo de la respuesta. Los límites piden 3 a 8 líneas; 1024 tokens son
 *  varias veces eso, así que solo corta una respuesta ya descarrilada. */
export const MAX_TOKENS_RESPUESTA = 1024;

/** La acción con la que se auditan las preguntas, independiente del cupo. */
const ENTIDAD_AYUDA = "usuario";

// ── Mensajes para la usuaria ────────────────────────────────────────────────
// Explícitos y con nombre: los tests los verifican y no dicen nada de la
// causa técnica.

export const MENSAJE_SIN_CLAVE =
  "La ayuda no está disponible en este momento. Probá más tarde; si sigue así, avisale a quien administra la app.";

export const MENSAJE_PROVEEDOR_CAIDO =
  "No pude responderte ahora mismo. Probá de nuevo en un ratito.";

export const MENSAJE_PREGUNTA_VACIA = "Escribí una pregunta.";

export const MENSAJE_PREGUNTA_LARGA = `La pregunta es muy larga: máximo ${LARGO_MAX_PREGUNTA} caracteres.`;

// ────────────────────────────────────────────────────────────────────────────

export interface TurnoAyuda {
  rol: "usuaria" | "asistente";
  texto: string;
}

export interface ResponderAyudaStreamingInput {
  pregunta: string;
  /** Los turnos previos, del más viejo al más nuevo. Se recortan a los
   *  últimos MAX_TURNOS_HISTORIAL. */
  historial?: TurnoAyuda[];
  /** Por defecto process.env.ANTHROPIC_API_KEY. Explícito para los tests. */
  apiKey?: string;
  /** Inyectable: los tests pasan un doble en vez de llamar a Anthropic. */
  crearStreaming?: typeof crearMensajeStreaming;
  /** Inyectable: evita leer el corpus del disco en los tests del caso de uso. */
  systemPrompt?: string;
  /** Capacidad cerrada, ligada por el servidor a la organización autenticada. */
  consultarAgenda?: ConsultarAgenda;
}

/**
 * Los últimos MAX_TURNOS_HISTORIAL turnos, traducidos a la forma que espera
 * la API. Se recorta por el final —los más nuevos son los que importan— y se
 * descartan los turnos vacíos, que la API rechaza.
 */
export function historialAMensajes(
  historial: readonly TurnoAyuda[],
): MensajeAnthropic[] {
  return historial
    .filter((turno) => turno.texto.trim() !== "")
    .slice(-MAX_TURNOS_HISTORIAL)
    .map((turno) => ({
      role: turno.rol === "usuaria" ? ("user" as const) : ("assistant" as const),
      content: turno.texto.trim(),
    }));
}

/**
 * Pregunta → respuesta, por fragmentos. Lanza ApiError 400 (pregunta
 * inválida), 503 (sin clave configurada) o 502 (el proveedor falló).
 *
 * Es la única forma de preguntar: la variante que devolvía la respuesta
 * entera existió hasta que la ruta pasó a streaming y después no la llamó
 * nadie más que sus propios tests.
 */
export async function responderAyudaStreaming(
  input: ResponderAyudaStreamingInput,
): Promise<FlujoMensajes> {
  const pregunta = input.pregunta.trim();
  if (pregunta === "") throw new ApiError(MENSAJE_PREGUNTA_VACIA, 400);
  if (pregunta.length > LARGO_MAX_PREGUNTA) {
    throw new ApiError(MENSAJE_PREGUNTA_LARGA, 400);
  }

  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[ayuda] ANTHROPIC_API_KEY no configurada");
    throw new ApiError(MENSAJE_SIN_CLAVE, 503);
  }

  try {
    const flujo = await (input.crearStreaming ?? crearMensajeStreaming)(
      {
        model: MODELO_AYUDA,
        max_tokens: MAX_TOKENS_RESPUESTA,
        system: systemCacheado(input.systemPrompt ?? systemPromptAyuda()),
        ...(input.consultarAgenda ? { tools: HERRAMIENTAS_AYUDA, tool_choice: { type: "auto" as const, disable_parallel_tool_use: true } } : {}),
        messages: [
          ...historialAMensajes(input.historial ?? []),
          { role: "user", content: pregunta },
        ],
      },
      { apiKey },
    );
    return input.consultarAgenda ? conConsultaAgenda(flujo, input.consultarAgenda) : flujo;
  } catch (error) {
    // Todo lo que viene del proveedor es ErrorAnthropic: se loguea sólo su
    // status y código (el mensaje puede traer el cuerpo de la respuesta).
    // Otra cosa es nuestra (el corpus, el armado del pedido): el pedido no
    // salió, se loguea con su causa y el cupo vuelve.
    const delProveedor = error instanceof ErrorAnthropic;
    console.error("[ayuda] fallo del proveedor", delProveedor ? diagnosticoDe(error) : error);
    throw new ErrorProveedorAsistente(MENSAJE_PROVEEDOR_CAIDO, !delProveedor || esErrorHttpDelProveedor(error));
  }
}

export interface PreguntaRespondida {
  prisma: ClienteAuditoria;
  organizationId: string;
  userId: string;
  largoPregunta: number;
  /** El largo de lo que se le mostró (ya sin markdown). */
  largoRespuesta: number;
  turnosHistorial: number;
  resultado: Pick<ResultadoMensajes, "tokensEntrada" | "tokensSalida" | "cacheLeido">;
}

/**
 * El rastro de una pregunta contestada: metadatos y nada más. Cuántos
 * caracteres tenía la pregunta, cuántos la respuesta, cuántos tokens, qué
 * modelo, cuánto se leyó del caché. NUNCA el texto de la pregunta ni el de la
 * respuesta: una pregunta de ayuda puede llevar adentro el nombre de una
 * paciente ("no me sale la nota de X"), y el registro existe para saber que
 * algo pasó, no qué decía. Informativo: el cupo ya se reservó antes del
 * proveedor y la auditoría no decide el límite.
 */
export async function registrarPreguntaAyuda(p: PreguntaRespondida): Promise<void> {
  await registrarAuditoria(p.prisma, {
    organizationId: p.organizationId,
    actorTipo: "usuario",
    actorId: p.userId,
    accion: ACCIONES.ayuda.pregunta,
    entidad: ENTIDAD_AYUDA,
    entidadId: p.userId,
    detalle: {
      largoPregunta: p.largoPregunta,
      largoRespuesta: p.largoRespuesta,
      turnosHistorial: p.turnosHistorial,
      modelo: MODELO_AYUDA,
      tokensEntrada: p.resultado.tokensEntrada,
      tokensSalida: p.resultado.tokensSalida,
      cacheLeido: p.resultado.cacheLeido,
    },
  });
}

/** El texto de ayuda sigue llegando por fragmentos. Una consulta de agenda
 * termina en el listado del servidor, sin otra llamada al proveedor. */
function conConsultaAgenda(flujo: FlujoMensajes, consultar: ConsultarAgenda): FlujoMensajes {
  let cancelado = false;
  let completar!: (valor: ResultadoMensajes) => void;
  let fallar!: (error: unknown) => void;
  const resultado = new Promise<ResultadoMensajes>((resolve, reject) => { completar = resolve; fallar = reject; });
  void resultado.catch(() => {});
  async function* leer() {
    let texto = "";
    try {
      for await (const parte of flujo.fragmentos) {
        if (cancelado) return;
        texto += parte;
        yield parte;
      }
      const original = await flujo.resultado;
      if (cancelado) return;
      const agenda = await resolverHerramienta(original, consultar);
      if (cancelado) return;
      if (agenda !== null) {
        const parte = `${texto ? "\n\n" : ""}${agenda}`;
        texto += parte;
        yield parte;
      }
      completar({ ...original, texto });
    } catch (error) {
      fallar(error);
      throw error;
    }
  }
  return {
    fragmentos: leer(), resultado,
    cancelar: () => { cancelado = true; flujo.cancelar(); fallar(new Error("Consulta cancelada")); },
  };
}

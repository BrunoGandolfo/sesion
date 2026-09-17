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
// loguea con detalle y se traduce a un ApiError con texto para la usuaria.
// El mensaje de ErrorAnthropic trae el cuerpo del proveedor y no se pasa
// nunca a la respuesta HTTP.
//
// Runtime nodejs: importa el corpus, que lee del disco.

import {
  crearMensaje,
  crearMensajeStreaming,
  MODELO_AYUDA,
  systemCacheado,
  type MensajeAnthropic,
  type ResultadoMensajes,
  type FlujoMensajes,
} from "@/lib/anthropic-mensajes";
import { systemPromptAyuda } from "@/lib/ayuda-corpus";

import { ApiError } from "../responses";
import { HERRAMIENTAS_AYUDA, resolverHerramienta, type ConsultarAgenda } from "./ayuda/herramientas";


/** Largo máximo de una pregunta. Mide caracteres, no tokens: es un tope
 *  contra el pegado accidental de media pantalla, no un control de gasto. */
export const LARGO_MAX_PREGUNTA = 600;

/** Cuántos turnos previos entran. Un turno es un mensaje, de cualquiera de
 *  las dos. Con 6 alcanza para un "¿y si no me anduvo?" encadenado, y el
 *  historial nunca crece hasta pesar como el corpus. */
export const MAX_TURNOS_HISTORIAL = 6;

/** Techo de la respuesta. Los límites piden 3 a 8 líneas; 1024 tokens son
 *  varias veces eso, así que solo corta una respuesta ya descarrilada. */
export const MAX_TOKENS_RESPUESTA = 1024;

/** Cuántas preguntas por usuaria por día. */
export const TOPE_PREGUNTAS_DIA = 40;

/** La acción con la que se auditan las preguntas, independiente del cupo. */
export const ACCION_AYUDA = "ayuda.pregunta";
export const ENTIDAD_AYUDA = "usuario";

// ── Mensajes para la usuaria ────────────────────────────────────────────────
// Explícitos y con nombre: los tests los verifican y no dicen nada de la
// causa técnica.

export const MENSAJE_SIN_CLAVE =
  "La ayuda no está disponible en este momento. Probá más tarde; si sigue así, avisale a quien administra la app.";

export const MENSAJE_PROVEEDOR_CAIDO =
  "No pude responderte ahora mismo. Probá de nuevo en un ratito.";

export const MENSAJE_TOPE_DIARIO = `Por hoy llegaste a las ${TOPE_PREGUNTAS_DIA} preguntas. Mañana se renueva. Mientras tanto, la ayuda escrita está toda en la app.`;

export const MENSAJE_PREGUNTA_VACIA = "Escribí una pregunta.";

export const MENSAJE_PREGUNTA_LARGA = `La pregunta es muy larga: máximo ${LARGO_MAX_PREGUNTA} caracteres.`;

// ────────────────────────────────────────────────────────────────────────────

export interface TurnoAyuda {
  rol: "usuaria" | "asistente";
  texto: string;
}

export interface ResponderAyudaInput {
  pregunta: string;
  /** Los turnos previos, del más viejo al más nuevo. Se recortan a los
   *  últimos MAX_TURNOS_HISTORIAL. */
  historial?: TurnoAyuda[];
  /** Por defecto process.env.ANTHROPIC_API_KEY. Explícito para los tests. */
  apiKey?: string;
  /** Inyectable: los tests pasan un doble en vez de llamar a Anthropic. */
  crear?: typeof crearMensaje;
  /** Inyectable: evita leer el corpus del disco en los tests del caso de uso. */
  systemPrompt?: string;
  /** Capacidad cerrada, ligada por el servidor a la organización autenticada. */
  consultarAgenda?: ConsultarAgenda;
}

export interface ResponderAyudaStreamingInput extends ResponderAyudaInput {
  crearStreaming?: typeof crearMensajeStreaming;
}

export interface RespuestaAyuda {
  respuesta: string;
  tokensEntrada: number;
  tokensSalida: number;
  cacheLeido: number;
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
 * Pregunta → respuesta. Lanza ApiError 400 (pregunta inválida), 503 (sin
 * clave configurada) o 502 (el proveedor falló).
 */
export async function responderAyuda(
  input: ResponderAyudaInput,
): Promise<RespuestaAyuda> {
  const pregunta = input.pregunta.trim();

  if (pregunta === "") {
    throw new ApiError(MENSAJE_PREGUNTA_VACIA, 400);
  }
  if (pregunta.length > LARGO_MAX_PREGUNTA) {
    throw new ApiError(MENSAJE_PREGUNTA_LARGA, 400);
  }

  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No es un error del que haya que enterarse por Sentry cada vez: es el
    // estado normal en local. Se loguea una línea y se contesta 503.
    console.warn("[ayuda] ANTHROPIC_API_KEY no configurada");
    throw new ApiError(MENSAJE_SIN_CLAVE, 503);
  }

  const crear = input.crear ?? crearMensaje;
  const system = input.systemPrompt ?? systemPromptAyuda();

  let resultado: ResultadoMensajes;
  try {
    resultado = await crear(
      {
        model: MODELO_AYUDA,
        max_tokens: MAX_TOKENS_RESPUESTA,
        // El system va primero y entero: es el prefijo que se cachea.
        system: systemCacheado(system),
        ...(input.consultarAgenda ? { tools: HERRAMIENTAS_AYUDA, tool_choice: { type: "auto" as const, disable_parallel_tool_use: true } } : {}),
        // Todo lo variable va después del corte del caché.
        messages: [
          ...historialAMensajes(input.historial ?? []),
          { role: "user", content: pregunta },
        ],
      },
      { apiKey },
    );
  } catch (error) {
    // El detalle del proveedor va al log de la función y muere ahí.
    console.error("[ayuda] fallo del proveedor", error);
    throw new ApiError(MENSAJE_PROVEEDOR_CAIDO, 502);
  }

  return {
    respuesta: input.consultarAgenda
      ? await resolverHerramienta(resultado, input.consultarAgenda) ?? resultado.texto
      : resultado.texto,
    tokensEntrada: resultado.tokensEntrada,
    tokensSalida: resultado.tokensSalida,
    cacheLeido: resultado.cacheLeido,
  };
}

/** La variante incremental: valida y arma exactamente el mismo pedido. */
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
    console.error("[ayuda] fallo del proveedor", error);
    throw new ApiError(MENSAJE_PROVEEDOR_CAIDO, 502);
  }
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

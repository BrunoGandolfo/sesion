// Cliente de Anthropic para la ayuda de Sesión.
// Usa el SDK oficial: MessageStream interpreta SSE y entrega deltas tipados.
// Runtime nodejs. No es alcanzable desde src/middleware.ts (regla 9).

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

export const MODELO_AYUDA = "claude-sonnet-5";
export const TIMEOUT_MS = 30_000;
export const URL_MENSAJES = "https://api.anthropic.com/v1/messages";
export const VERSION_API_ANTHROPIC = "2023-06-01";

export interface BloqueSystem extends TextBlockParam {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface MensajeAnthropic {
  role: "user" | "assistant";
  content: string;
}

export interface PedidoMensajes {
  model: string;
  max_tokens: number;
  system: BloqueSystem[];
  messages: MensajeAnthropic[];
  temperature?: number;
}

export interface ResultadoMensajes {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
  cacheLeido: number;
  cacheEscrito: number;
  motivoDeCorte: string | null;
}

export class ErrorAnthropic extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ErrorAnthropic";
  }
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface OpcionesMensajes {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Un stream listo para consumir. resultado se resuelve sólo después de EOF. */
export interface FlujoMensajes {
  fragmentos: AsyncIterable<string>;
  resultado: Promise<ResultadoMensajes>;
  cancelar: () => void;
}

export function systemCacheado(texto: string): BloqueSystem[] {
  return [{ type: "text", text: texto, cache_control: { type: "ephemeral" } }];
}

function cliente(opciones: OpcionesMensajes): Anthropic {
  return new Anthropic({
    apiKey: opciones.apiKey,
    timeout: opciones.timeoutMs ?? TIMEOUT_MS,
    maxRetries: 0,
    ...(opciones.fetchImpl
      ? { fetch: opciones.fetchImpl as unknown as typeof fetch }
      : {}),
  });
}

function resultadoDe(mensaje: Message): ResultadoMensajes {
  const usage = mensaje.usage;
  const texto = mensaje.content
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("")
    .trim();

  if (texto === "") {
    throw new ErrorAnthropic(
      `respuesta sin texto (stop_reason=${mensaje.stop_reason ?? "?"})`,
    );
  }

  return {
    texto,
    tokensEntrada: usage?.input_tokens ?? 0,
    tokensSalida: usage?.output_tokens ?? 0,
    cacheLeido: usage?.cache_read_input_tokens ?? 0,
    cacheEscrito: usage?.cache_creation_input_tokens ?? 0,
    motivoDeCorte: mensaje.stop_reason ?? null,
  };
}

function envolverError(error: unknown): ErrorAnthropic {
  if (error instanceof ErrorAnthropic) return error;
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  const detalle =
    error instanceof Error ? error.message.slice(0, 500) : "desconocido";
  return new ErrorAnthropic(detalle, status);
}

/** Camino no incremental conservado para pruebas y consumidores internos. */
export async function crearMensaje(
  pedido: PedidoMensajes,
  opciones: OpcionesMensajes,
): Promise<ResultadoMensajes> {
  try {
    const mensaje = await cliente(opciones).messages.create({
      ...pedido,
      system: pedido.system,
      messages: pedido.messages as MessageParam[],
    });
    return resultadoDe(mensaje);
  } catch (error) {
    throw envolverError(error);
  }
}

/**
 * Abre el SSE y espera el handshake. Los 4xx/5xx iniciales todavía pueden
 * convertirse en un status HTTP propio; luego fragmentos entrega text_delta.
 */
export async function crearMensajeStreaming(
  pedido: PedidoMensajes,
  opciones: OpcionesMensajes,
): Promise<FlujoMensajes> {
  // El timeout del SDK termina al recibir las cabeceras. Este plazo cubre
  // también el body SSE, hasta el último evento o la cancelación.
  const controller = new AbortController();
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_MS;
  let vencido = false;
  const temporizador = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, timeoutMs);
  const limpiar = () => clearTimeout(temporizador);
  const errorDelFlujo = (error: unknown) =>
    vencido
      ? new ErrorAnthropic(`Timeout de Anthropic después de ${timeoutMs} ms`)
      : envolverError(error);

  try {
    const stream = cliente(opciones).messages.stream({
      ...pedido,
      system: pedido.system,
      messages: pedido.messages as MessageParam[],
    }, { signal: controller.signal });
    stream.once("end", limpiar);
    // Registrar el iterador antes de que lleguen eventos, incluso si quien
    // llama demora en consumir los fragmentos o el timeout vence antes.
    const eventos = stream[Symbol.asyncIterator]();
    await stream.withResponse();

    const resultado = stream.finalMessage().then(resultadoDe).catch((error) => {
      throw errorDelFlujo(error);
    });
    // El iterador y el resultado reflejan el mismo error. Si quien consume se
    // corta al fallar el iterador, esta guarda evita una rejection huérfana.
    void resultado.catch(() => {});

    async function* leer(): AsyncGenerator<string> {
      try {
        for await (const evento of { [Symbol.asyncIterator]: () => eventos }) {
          if (
            evento.type === "content_block_delta" &&
            evento.delta.type === "text_delta"
          ) {
            yield evento.delta.text;
          }
        }
        await resultado;
      } catch (error) {
        throw errorDelFlujo(error);
      } finally {
        limpiar();
      }
    }

    return {
      fragmentos: leer(),
      resultado,
      cancelar: () => {
        limpiar();
        controller.abort();
      },
    };
  } catch (error) {
    limpiar();
    throw errorDelFlujo(error);
  }
}

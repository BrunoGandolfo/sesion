// Cliente de Anthropic para los dos asistentes de Sesión: Lupita (ayuda de
// uso y agenda) y Lux (la colega con la que se conversa sobre un paciente).
// Usa el SDK oficial: MessageStream interpreta SSE y entrega deltas tipados.
// Runtime nodejs. No es alcanzable desde src/proxy.ts (regla 9).
//
// Dos caminos, a propósito separados:
//   - crearMensajeStreaming: UNA ronda. Si el modelo pide una herramienta, la
//     respuesta termina ahí y quien llama decide (Lupita: el servidor arma el
//     listado de agenda sin volver al modelo).
//   - crearConversacionConHerramientas: el bucle completo. El modelo pide una
//     herramienta, el servidor la ejecuta, le devuelve el tool_result y el
//     modelo sigue, hasta end_turn o el tope de llamadas (Lux).

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

import { detalleDeError } from "@/lib/detalle-error";

export const MODELO_AYUDA = "claude-haiku-5-5";
export const MODELO_LUX = "claude-haiku-5-5";
const TIMEOUT_MS = 30_000;

interface BloqueSystem extends TextBlockParam {
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
  tools?: Tool[];
  tool_choice?: { type: "auto"; disable_parallel_tool_use: boolean };
}

export interface LlamadaHerramienta {
  nombre: string;
  entrada: unknown;
}

export interface ResultadoMensajes {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
  cacheLeido: number;
  cacheEscrito: number;
  motivoDeCorte: string | null;
  herramientas?: LlamadaHerramienta[];
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

interface OpcionesMensajes {
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

function resultadoDe(mensaje: Message, permiteHerramientas = false): ResultadoMensajes {
  const usage = mensaje.usage;
  const texto = mensaje.content
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("")
    .trim();

  const herramientas = mensaje.content
    .filter((bloque) => bloque.type === "tool_use")
    .map((bloque) => ({ nombre: bloque.name, entrada: bloque.input }));
  if (herramientas.length && !permiteHerramientas) {
    throw new ErrorAnthropic("respuesta con herramientas no habilitadas");
  }

  if (texto === "" && herramientas.length === 0) {
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
    ...(herramientas.length ? { herramientas } : {}),
  };
}

function envolverError(error: unknown): ErrorAnthropic {
  if (error instanceof ErrorAnthropic) return error;
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  const detalle = detalleDeError(error, "desconocido").slice(0, 500);
  return new ErrorAnthropic(detalle, status);
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

    const resultado = stream.finalMessage().then((mensaje) => resultadoDe(mensaje, Boolean(pedido.tools?.length))).catch((error) => {
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

// ─── El bucle de herramientas ────────────────────────────────────────────────

export interface RespuestaHerramienta {
  /** Lo que vuelve al modelo como tool_result. */
  contenido: string;
  /** true: la llamada se rechazó (id fuera de lista, argumentos inválidos). */
  esError?: boolean;
}

/** Lo que el servidor sabe hacer cuando el modelo pide una herramienta. La
 *  lista cerrada y la validación de argumentos viven del lado de quien lo
 *  implementa: este cliente no interpreta ninguna llamada. */
export interface EjecutorHerramientas {
  /** Línea que se emite en el stream ANTES de ejecutar, o null. */
  aviso(llamada: LlamadaHerramienta): string | null;
  ejecutar(llamada: LlamadaHerramienta): Promise<RespuestaHerramienta>;
}

export interface PedidoConversacion {
  model: string;
  max_tokens: number;
  system: BloqueSystem[];
  messages: MessageParam[];
  tools: Tool[];
}

export interface ResultadoConversacion extends ResultadoMensajes {
  /** Cada llamada que el modelo pidió y el servidor atendió, en orden. */
  llamadas: (LlamadaHerramienta & { rechazada: boolean })[];
  rondas: number;
}

export interface FlujoConversacion {
  fragmentos: AsyncIterable<string>;
  resultado: Promise<ResultadoConversacion>;
  cancelar: () => void;
}

/** Tope de llamadas a herramientas por pregunta. */
export const MAX_LLAMADAS_HERRAMIENTA = 3;

/**
 * Pregunta → (herramienta → resultado → modelo)* → respuesta, por fragmentos.
 *
 * Una herramienta por ronda (disable_parallel_tool_use). Después de la
 * llamada número `maxLlamadas`, la ronda siguiente va con tool_choice "none":
 * el modelo tiene que contestar con lo que ya tiene. Las herramientas siguen
 * declaradas porque el historial lleva tool_use y tool_result, y la API las
 * exige en ese caso.
 *
 * El contenido entero de cada respuesta del modelo (incluidos los bloques de
 * thinking, firmados) vuelve tal cual en el historial: editarlo invalida el
 * razonamiento en los modelos actuales.
 *
 * Como crearMensajeStreaming, espera el handshake de la primera ronda antes
 * de devolver: un 4xx/5xx inicial todavía se convierte en un status propio.
 * El plazo cubre la conversación entera, no cada ronda.
 */
export async function crearConversacionConHerramientas(
  pedido: PedidoConversacion,
  ejecutor: EjecutorHerramientas,
  opciones: OpcionesMensajes & { maxLlamadas?: number },
): Promise<FlujoConversacion> {
  const maxLlamadas = opciones.maxLlamadas ?? MAX_LLAMADAS_HERRAMIENTA;
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

  // Sin reintentos del SDK y con el plazo propio: el del SDK se pone igual
  // para que no corte antes que el nuestro.
  const anthropic = cliente(opciones);
  const mensajes: MessageParam[] = [...pedido.messages];

  function abrirRonda(conHerramientas: boolean) {
    const stream = anthropic.messages.stream({
      ...pedido,
      messages: mensajes,
      tool_choice: conHerramientas
        ? { type: "auto", disable_parallel_tool_use: true }
        : { type: "none" },
    }, { signal: controller.signal });
    // Registrar el iterador antes de que lleguen eventos (ver arriba), y la
    // promesa final ya, para que un error con nadie escuchando no quede como
    // rejection huérfana del SDK.
    const eventos = stream[Symbol.asyncIterator]();
    const final = stream.finalMessage();
    void final.catch(() => {});
    return { stream, eventos, final };
  }

  let ronda: ReturnType<typeof abrirRonda>;
  try {
    ronda = abrirRonda(maxLlamadas > 0);
    await ronda.stream.withResponse();
  } catch (error) {
    limpiar();
    throw errorDelFlujo(error);
  }

  let completar!: (valor: ResultadoConversacion) => void;
  let fallar!: (error: unknown) => void;
  const resultado = new Promise<ResultadoConversacion>((resolve, reject) => {
    completar = resolve;
    fallar = reject;
  });
  void resultado.catch(() => {});
  let cancelado = false;

  async function* leer(): AsyncGenerator<string> {
    let texto = "";
    let llamadas = 0;
    let rondas = 0;
    const uso = { tokensEntrada: 0, tokensSalida: 0, cacheLeido: 0, cacheEscrito: 0 };
    const atendidas: ResultadoConversacion["llamadas"] = [];
    try {
      while (true) {
        let textoRonda = "";
        for await (const evento of { [Symbol.asyncIterator]: () => ronda.eventos }) {
          if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
            textoRonda += evento.delta.text;
            texto += evento.delta.text;
            yield evento.delta.text;
          }
        }
        const mensaje: Message = await ronda.final;
        rondas += 1;
        uso.tokensEntrada += mensaje.usage?.input_tokens ?? 0;
        uso.tokensSalida += mensaje.usage?.output_tokens ?? 0;
        uso.cacheLeido += mensaje.usage?.cache_read_input_tokens ?? 0;
        uso.cacheEscrito += mensaje.usage?.cache_creation_input_tokens ?? 0;

        const pedidas = mensaje.content.filter((bloque) => bloque.type === "tool_use");
        if (mensaje.stop_reason !== "tool_use" || pedidas.length === 0) {
          // La respuesta es la de esta ronda: un aviso o un preámbulo de una
          // ronda anterior no cuentan como contestar.
          if (textoRonda.trim() === "") {
            throw new ErrorAnthropic(`respuesta sin texto (stop_reason=${mensaje.stop_reason ?? "?"})`);
          }
          // Una respuesta cortada por el techo de tokens o por un rechazo no
          // terminó: se dice como un corte, no como una respuesta completa
          // que después vuelve en el historial.
          if (mensaje.stop_reason === "max_tokens" || mensaje.stop_reason === "refusal") {
            throw new ErrorAnthropic(`respuesta incompleta (stop_reason=${mensaje.stop_reason})`);
          }
          completar({
            texto: texto.trim(),
            ...uso,
            motivoDeCorte: mensaje.stop_reason ?? null,
            llamadas: atendidas,
            rondas,
          });
          return;
        }

        mensajes.push({ role: "assistant", content: mensaje.content });
        const resultados: ToolResultBlockParam[] = [];
        for (const pedida of pedidas) {
          llamadas += 1;
          const llamada = { nombre: pedida.name, entrada: pedida.input };
          // Defensivo: con disable_parallel_tool_use y tool_choice "none" al
          // llegar al tope, esto no debería pasar nunca.
          if (llamadas > maxLlamadas) {
            atendidas.push({ ...llamada, rechazada: true });
            resultados.push({
              type: "tool_result", tool_use_id: pedida.id, is_error: true,
              content: "Llegaste al tope de lecturas para esta pregunta. Contestá con lo que ya tenés.",
            });
            continue;
          }
          const aviso = ejecutor.aviso(llamada);
          if (aviso) {
            const parte = `${texto && !texto.endsWith("\n") ? "\n\n" : ""}${aviso}\n\n`;
            texto += parte;
            yield parte;
          }
          const respuesta = await ejecutor.ejecutar(llamada);
          if (cancelado) return;
          atendidas.push({ ...llamada, rechazada: Boolean(respuesta.esError) });
          resultados.push({
            type: "tool_result", tool_use_id: pedida.id, content: respuesta.contenido,
            ...(respuesta.esError ? { is_error: true } : {}),
          });
        }
        mensajes.push({ role: "user", content: resultados });
        ronda = abrirRonda(llamadas < maxLlamadas);
      }
    } catch (error) {
      const envuelto = error instanceof ErrorAnthropic ? error : errorDelFlujo(error);
      fallar(envuelto);
      throw envuelto;
    } finally {
      limpiar();
    }
  }

  return {
    fragmentos: leer(),
    resultado,
    cancelar: () => {
      cancelado = true;
      limpiar();
      controller.abort();
      fallar(new ErrorAnthropic("Conversación cancelada"));
    },
  };
}

// Cliente mínimo de la API de mensajes de Anthropic, con fetch.
//
// POR QUÉ NO EL SDK
//
// El SDK oficial (@anthropic-ai/sdk) trae reintentos, streaming, tipos de
// todas las herramientas y el runner de tool use. De todo eso, /api/ayuda usa
// cero: una llamada, sin streaming, sin herramientas, con un system prompt y
// un historial corto. Lo que sí trae es una dependencia más para auditar y
// mantener en una app que hoy tiene 17. Cuando aparezca el streaming en la UI
// —que es la razón por la que el SDK se vuelve razonable, porque parsear SSE
// a mano no se justifica— se cambia; hasta entonces, esto son 40 líneas.
//
// PROMPT CACHING
//
// El caché se pide con `cache_control: { type: "ephemeral" }` en el bloque
// del system, no con una cabecera: el beta `prompt-caching-2024-07-31` quedó
// obsoleto cuando la función salió de beta, y mandarlo hoy no agrega nada.
// Las únicas cabeceras necesarias son la clave, la versión y el content-type.
//
// El bloque cacheado tiene que ser un prefijo estable: por eso el system va
// entero antes que los mensajes, y todo lo que cambia por pedido —la
// pregunta, el historial— va después. Ver src/lib/ayuda-corpus.ts.
//
// Runtime nodejs. No es alcanzable desde src/middleware.ts (regla 9).

export const URL_MENSAJES = "https://api.anthropic.com/v1/messages";

/** Versión de la API de Anthropic. Cabecera obligatoria. */
export const VERSION_API_ANTHROPIC = "2023-06-01";

/**
 * El modelo. Haiku 4.5 es el más chico de la generación actual: alcanza de
 * sobra para responder desde un corpus que ya está en el prompt, y con el
 * caché el corpus se lee al 10 % del precio de entrada.
 *
 * El identificador NO lleva sufijo de fecha: `claude-haiku-4-5` es completo
 * tal cual.
 */
export const MODELO_AYUDA = "claude-haiku-4-5";

/** Techo de espera de una llamada. Sin streaming, una respuesta corta de
 *  Haiku entra en pocos segundos; 30 s es el margen para un mal día de red. */
export const TIMEOUT_MS = 30_000;

// ────────────────────────────────────────────────────────────────────────────
// Tipos de la API (solo la parte que se usa)
// ────────────────────────────────────────────────────────────────────────────

/** Bloque de texto del system, opcionalmente marcado para cachear. */
export interface BloqueSystem {
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

/** La respuesta de /v1/messages, recortada a lo que se lee. */
interface CuerpoRespuesta {
  content?: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  stop_reason?: string;
}

/** Lo que devuelve crearMensaje, ya masticado. */
export interface ResultadoMensajes {
  /** El texto de la respuesta: los bloques `text` concatenados. */
  texto: string;
  /** Tokens de entrada NO cacheados (los cacheados van aparte). */
  tokensEntrada: number;
  tokensSalida: number;
  /** Tokens leídos del caché: si es 0 pedido tras pedido, algo lo invalida. */
  cacheLeido: number;
  /** Tokens escritos al caché (se pagan ~1,25x; pasa en el primer pedido). */
  cacheEscrito: number;
  /** `end_turn`, `max_tokens`, `refusal`… Puede faltar. */
  motivoDeCorte: string | null;
}

/**
 * Cualquier cosa que salga mal hablando con Anthropic: red, timeout, 4xx,
 * 5xx, cuerpo que no es JSON. `status` está solo cuando hubo respuesta HTTP.
 *
 * El mensaje puede contener detalle del proveedor: es para el log, NUNCA
 * para la usuaria. Quien lo atrapa (responder-ayuda.ts) lo traduce.
 */
export class ErrorAnthropic extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ErrorAnthropic";
  }
}

/** La firma de fetch que hace falta. Inyectable para los tests. */
export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface OpcionesMensajes {
  apiKey: string;
  /** Por defecto el fetch global. Los tests pasan el suyo. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

// ────────────────────────────────────────────────────────────────────────────

/** Arma el bloque de system cacheado. Un solo bloque: el prefijo entero. */
export function systemCacheado(texto: string): BloqueSystem[] {
  return [{ type: "text", text: texto, cache_control: { type: "ephemeral" } }];
}

/**
 * Una llamada a POST /v1/messages. Sin reintentos: quien llama decide (hoy
 * nadie reintenta — la usuaria vuelve a preguntar, que es más barato que
 * duplicar una llamada que quizás salió bien).
 */
export async function crearMensaje(
  pedido: PedidoMensajes,
  opciones: OpcionesMensajes,
): Promise<ResultadoMensajes> {
  const hacerFetch = opciones.fetchImpl ?? fetch;
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_MS;

  let respuesta: Response;
  try {
    respuesta = await hacerFetch(URL_MENSAJES, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opciones.apiKey,
        "anthropic-version": VERSION_API_ANTHROPIC,
      },
      body: JSON.stringify(pedido),
      // AbortSignal.timeout aborta y rechaza con TimeoutError; no hay
      // clearTimeout que olvidar ni handle que quede vivo.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const causa = error instanceof Error ? error.name : "desconocido";
    throw new ErrorAnthropic(`fetch falló (${causa})`);
  }

  if (!respuesta.ok) {
    // El cuerpo del error trae el motivo de Anthropic; se lee best-effort y
    // se recorta, que un 500 puede venir con una página entera de HTML.
    let cuerpo = "";
    try {
      cuerpo = (await respuesta.text()).slice(0, 500);
    } catch {
      cuerpo = "(sin cuerpo)";
    }
    throw new ErrorAnthropic(
      `HTTP ${respuesta.status}: ${cuerpo}`,
      respuesta.status,
    );
  }

  let cuerpo: CuerpoRespuesta;
  try {
    cuerpo = (await respuesta.json()) as CuerpoRespuesta;
  } catch {
    throw new ErrorAnthropic("la respuesta no es JSON", respuesta.status);
  }

  const texto = (cuerpo.content ?? [])
    .filter((bloque) => bloque.type === "text" && typeof bloque.text === "string")
    .map((bloque) => bloque.text as string)
    .join("")
    .trim();

  if (texto === "") {
    throw new ErrorAnthropic(
      `respuesta sin texto (stop_reason=${cuerpo.stop_reason ?? "?"})`,
      respuesta.status,
    );
  }

  return {
    texto,
    tokensEntrada: cuerpo.usage?.input_tokens ?? 0,
    tokensSalida: cuerpo.usage?.output_tokens ?? 0,
    cacheLeido: cuerpo.usage?.cache_read_input_tokens ?? 0,
    cacheEscrito: cuerpo.usage?.cache_creation_input_tokens ?? 0,
    motivoDeCorte: cuerpo.stop_reason ?? null,
  };
}

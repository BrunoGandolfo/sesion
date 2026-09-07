// Unitario — el cliente de /v1/messages.
//
// Sin red: se inyecta un fetch de mentira. Lo que se prueba es el contrato
// con Anthropic (qué se manda, qué se lee de lo que vuelve) y, sobre todo,
// que ningún camino de error devuelva algo parecido a un éxito: un 500 del
// proveedor, un cuerpo que no es JSON o una respuesta sin texto tienen que
// LANZAR, no devolver una respuesta vacía que la usuaria vería como un
// silencio.

import { describe, expect, it, vi } from "vitest";

import {
  crearMensaje,
  ErrorAnthropic,
  MODELO_AYUDA,
  systemCacheado,
  TIMEOUT_MS,
  URL_MENSAJES,
  VERSION_API_ANTHROPIC,
  type FetchLike,
  type PedidoMensajes,
} from "@/lib/anthropic-mensajes";

const API_KEY = "sk-ant-de-prueba";

const PEDIDO: PedidoMensajes = {
  model: MODELO_AYUDA,
  max_tokens: 1024,
  system: systemCacheado("corpus de mentira"),
  messages: [{ role: "user", content: "¿cómo cobro un turno?" }],
};

const CUERPO_OK = {
  content: [{ type: "text", text: "Entrá a Agenda y tocá “Cobrar”." }],
  usage: {
    input_tokens: 12,
    output_tokens: 34,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 20_000,
  },
  stop_reason: "end_turn",
};

/** fetch de mentira que contesta lo que se le diga. */
function fetchQueContesta(
  cuerpo: unknown,
  init: { status?: number; texto?: string } = {},
): { fetchImpl: FetchLike; llamadas: Array<[string, RequestInit]> } {
  const llamadas: Array<[string, RequestInit]> = [];
  const fetchImpl: FetchLike = async (url, opciones) => {
    llamadas.push([url, opciones]);
    const texto = init.texto ?? JSON.stringify(cuerpo);
    return new Response(texto, {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, llamadas };
}

/**
 * El error que lanzó una promesa, tipado. `.catch(e => e as X)` deja una
 * unión con el tipo resuelto y no avisa si la promesa NO falla; esto sí.
 */
async function atrapar<T extends Error>(promesa: Promise<unknown>): Promise<T> {
  try {
    await promesa;
  } catch (error) {
    return error as T;
  }
  throw new Error("se esperaba un error y la promesa resolvió");
}

describe("systemCacheado", () => {
  it("es un solo bloque de texto marcado para cachear", () => {
    expect(systemCacheado("hola")).toEqual([
      { type: "text", text: "hola", cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("crearMensaje — lo que manda", () => {
  it("postea a /v1/messages con la clave y la versión", async () => {
    const { fetchImpl, llamadas } = fetchQueContesta(CUERPO_OK);
    await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });

    const [url, opciones] = llamadas[0];
    expect(url).toBe(URL_MENSAJES);
    expect(opciones.method).toBe("POST");
    expect(opciones.headers).toMatchObject({
      "x-api-key": API_KEY,
      "anthropic-version": VERSION_API_ANTHROPIC,
      "content-type": "application/json",
    });
  });

  it("no manda la cabecera beta de prompt caching (salió de beta)", async () => {
    const { fetchImpl, llamadas } = fetchQueContesta(CUERPO_OK);
    await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });

    const headers = llamadas[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(
      "anthropic-beta",
    );
  });

  it("manda el pedido tal cual, con el cache_control adentro", async () => {
    const { fetchImpl, llamadas } = fetchQueContesta(CUERPO_OK);
    await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });

    const enviado = JSON.parse(llamadas[0][1].body as string);
    expect(enviado).toEqual(PEDIDO);
    expect(enviado.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("aborta con una señal de timeout", async () => {
    const { fetchImpl, llamadas } = fetchQueContesta(CUERPO_OK);
    await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });

    expect(llamadas[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("el timeout por defecto son 30 s", () => {
    expect(TIMEOUT_MS).toBe(30_000);
  });
});

describe("crearMensaje — lo que lee", () => {
  it("devuelve el texto y las métricas de uso", async () => {
    const { fetchImpl } = fetchQueContesta(CUERPO_OK);
    const r = await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });

    expect(r).toEqual({
      texto: "Entrá a Agenda y tocá “Cobrar”.",
      tokensEntrada: 12,
      tokensSalida: 34,
      cacheLeido: 20_000,
      cacheEscrito: 0,
      motivoDeCorte: "end_turn",
    });
  });

  it("concatena varios bloques de texto y descarta los que no lo son", async () => {
    const { fetchImpl } = fetchQueContesta({
      content: [
        { type: "thinking", thinking: "…" },
        { type: "text", text: "uno " },
        { type: "text", text: "dos" },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const r = await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });
    expect(r.texto).toBe("uno dos");
  });

  it("con usage ausente devuelve ceros, no undefined", async () => {
    const { fetchImpl } = fetchQueContesta({
      content: [{ type: "text", text: "hola" }],
    });
    const r = await crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl });
    expect(r.tokensEntrada).toBe(0);
    expect(r.tokensSalida).toBe(0);
    expect(r.cacheLeido).toBe(0);
    expect(r.motivoDeCorte).toBeNull();
  });
});

describe("crearMensaje — los errores", () => {
  it("lanza con el status ante un 4xx", async () => {
    const { fetchImpl } = fetchQueContesta(null, {
      status: 401,
      texto: '{"error":{"message":"invalid x-api-key"}}',
    });
    await expect(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    ).rejects.toMatchObject({ name: "ErrorAnthropic", status: 401 });
  });

  it("lanza ante un 5xx", async () => {
    const { fetchImpl } = fetchQueContesta(null, {
      status: 529,
      texto: "overloaded",
    });
    await expect(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    ).rejects.toBeInstanceOf(ErrorAnthropic);
  });

  it("recorta el cuerpo del error: un 500 puede venir con una página entera", async () => {
    const { fetchImpl } = fetchQueContesta(null, {
      status: 500,
      texto: "x".repeat(5000),
    });
    const error = await atrapar<ErrorAnthropic>(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    );

    expect(error.message.length).toBeLessThan(600);
  });

  it("lanza si el cuerpo no es JSON", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("<html>502</html>", { status: 200 });
    await expect(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    ).rejects.toBeInstanceOf(ErrorAnthropic);
  });

  it("lanza si la respuesta no trae texto, en vez de devolver vacío", async () => {
    const { fetchImpl } = fetchQueContesta({
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
      stop_reason: "refusal",
    });
    await expect(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    ).rejects.toThrow(/refusal/);
  });

  it("envuelve un fallo de red en ErrorAnthropic", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as FetchLike;

    const error = await atrapar<ErrorAnthropic>(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl }),
    );

    expect(error).toBeInstanceOf(ErrorAnthropic);
    expect(error.status).toBeUndefined();
  });

  it("respeta el timeout: una llamada que no contesta rechaza", async () => {
    const fetchImpl: FetchLike = (_url, opciones) =>
      new Promise((_resolver, rechazar) => {
        opciones.signal?.addEventListener("abort", () => {
          rechazar(new DOMException("aborted", "TimeoutError"));
        });
      });

    await expect(
      crearMensaje(PEDIDO, { apiKey: API_KEY, fetchImpl, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ErrorAnthropic);
  });
});

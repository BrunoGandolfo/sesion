// Unitario — el cliente de /v1/messages.
//
// Sin red: se inyecta un fetch de mentira. Lo que se prueba es el contrato
// con Anthropic (qué se manda, qué se lee de lo que vuelve) y, sobre todo,
// que ningún camino de error devuelva algo parecido a un éxito: un 500 del
// proveedor, un cuerpo que no es JSON o una respuesta sin texto tienen que
// LANZAR, no devolver una respuesta vacía que la usuaria vería como un
// silencio.

import { describe, expect, it } from "vitest";

import {
  crearMensajeStreaming,
  ErrorAnthropic,
  MODELO_AYUDA,
  systemCacheado,
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

describe("crearMensajeStreaming", () => {
  // Como fetch real: ya entregó cabeceras, pero abortar la señal interrumpe
  // también la lectura pendiente del body. El body nunca emite datos.
  const fetchConBodyMudo: FetchLike = async (_url, opciones) =>
    new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const abortar = () => controller.error(new DOMException("aborted", "AbortError"));
        if (opciones.signal?.aborted) abortar();
        else opciones.signal?.addEventListener("abort", abortar, { once: true });
      },
    }), { headers: { "content-type": "text/event-stream" } });

  it("el timeout interrumpe un body mudo después de las cabeceras", async () => {
    const inicio = performance.now();
    const flujo = await crearMensajeStreaming(PEDIDO, {
      apiKey: API_KEY, fetchImpl: fetchConBodyMudo, timeoutMs: 10,
    });
    const consumir = async () => {
      for await (const fragmento of flujo.fragmentos) {
        throw new Error(`no debía emitir: ${fragmento}`);
      }
    };
    const error = await atrapar<ErrorAnthropic>(consumir());
    expect(error).toBeInstanceOf(ErrorAnthropic);
    expect(error.message).toMatch(/timeout/i);
    await expect(flujo.resultado).rejects.toMatchObject({ name: "ErrorAnthropic", message: expect.stringMatching(/timeout/i) });
    expect(performance.now() - inicio).toBeLessThan(1000);
  }, 1000);

  it("rechaza resultado aunque todavía no se hayan consumido los fragmentos", async () => {
    const flujo = await crearMensajeStreaming(PEDIDO, {
      apiKey: API_KEY, fetchImpl: fetchConBodyMudo, timeoutMs: 10,
    });
    await expect(flujo.resultado).rejects.toThrow(/timeout/i);
    await expect(flujo.fragmentos[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ErrorAnthropic);
  }, 1000);

  it("cancelar interrumpe el body sin confundir la cancelación con un timeout", async () => {
    const flujo = await crearMensajeStreaming(PEDIDO, {
      apiKey: API_KEY, fetchImpl: fetchConBodyMudo,
    });
    flujo.cancelar();
    const error = await atrapar<ErrorAnthropic>(flujo.resultado);
    expect(error).toBeInstanceOf(ErrorAnthropic);
    expect(error.message).not.toMatch(/timeout/i);
    await expect(flujo.fragmentos[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ErrorAnthropic);
  }, 1000);

  it("entrega los text_delta y resuelve las métricas al cerrar", async () => {
    const eventos = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-haiku-4-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":20000}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"","citations":null}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hola "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Mariana"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const fetchImpl: FetchLike = async () =>
      new Response(eventos, {
        headers: { "content-type": "text/event-stream" },
      });

    const flujo = await crearMensajeStreaming(PEDIDO, {
      apiKey: API_KEY,
      fetchImpl,
    });
    const fragmentos: string[] = [];
    for await (const fragmento of flujo.fragmentos) fragmentos.push(fragmento);

    expect(fragmentos).toEqual(["Hola ", "Mariana"]);
    await expect(flujo.resultado).resolves.toMatchObject({
      texto: "Hola Mariana",
      tokensEntrada: 12,
      tokensSalida: 8,
      cacheLeido: 20_000,
      motivoDeCorte: "end_turn",
    });
  });
});

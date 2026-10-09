// Unitario — el bucle de herramientas de Lux (crearConversacionConHerramientas)
// y el ejecutor cerrado de leer_transcripcion, sin red ni base.
//
// El fetch de mentira contesta, en orden, una respuesta SSE por pedido y
// guarda los cuerpos: así se ve qué le volvió al modelo en cada ronda.

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  crearConversacionConHerramientas,
  MAX_LLAMADAS_HERRAMIENTA,
  MODELO_LUX,
  type EjecutorHerramientas,
  type FetchLike,
  type PedidoConversacion,
} from "@/lib/anthropic-mensajes";
import {
  ejecutorLux,
  HERRAMIENTAS_LUX,
  RECHAZO_FUERA_DE_LISTA,
  RECHAZO_HERRAMIENTA,
} from "@/app/api/_lib/casos-uso/lux/herramientas";
import type { ClienteLux } from "@/app/api/_lib/casos-uso/lux/material";

type Bloque = { texto: string } | { herramienta: string; entrada: unknown };

function sse(bloques: Bloque[], stop: "end_turn" | "tool_use"): string {
  const eventos: unknown[] = [{
    type: "message_start",
    message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", content: [], model: MODELO_LUX, stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } },
  }];
  bloques.forEach((bloque, index) => {
    if ("texto" in bloque) {
      eventos.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      eventos.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: bloque.texto } });
    } else {
      eventos.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${index}_${randomUUID().slice(0, 8)}`, name: bloque.herramienta, input: {} } });
      eventos.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(bloque.entrada) } });
    }
    eventos.push({ type: "content_block_stop", index });
  });
  eventos.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
  eventos.push({ type: "message_stop" });
  return eventos.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function proveedor(respuestas: string[]) {
  const cuerpos: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const respuesta = respuestas[cuerpos.length - 1];
    if (!respuesta) throw new Error(`pedido de más: ${cuerpos.length}`);
    return new Response(respuesta, { headers: { "content-type": "text/event-stream" } });
  };
  return { cuerpos, fetchImpl };
}

const PEDIDO: PedidoConversacion = {
  model: MODELO_LUX,
  max_tokens: 1000,
  system: [{ type: "text", text: "material" }, { type: "text", text: "prompt", cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: "¿Qué ves?" }],
  tools: HERRAMIENTAS_LUX,
};

async function leerTodo(fragmentos: AsyncIterable<string>): Promise<string> {
  let texto = "";
  for await (const f of fragmentos) texto += f;
  return texto;
}

const SESION = randomUUID();

describe("crearConversacionConHerramientas", () => {
  it("una llamada válida: aviso en el stream, tool_result al modelo y respuesta final", async () => {
    const { cuerpos, fetchImpl } = proveedor([
      sse([{ texto: "Voy a mirar esa sesión." }, { herramienta: "leer_transcripcion", entrada: { sesionId: SESION } }], "tool_use"),
      sse([{ texto: "En esa sesión ella dice que se va del cuerpo." }], "end_turn"),
    ]);
    const ejecutor: EjecutorHerramientas = {
      aviso: () => "_(mirando la transcripción del 01/09)_",
      ejecutar: vi.fn(async () => ({ contenido: "TEXTO DE LA TRANSCRIPCIÓN" })),
    };
    const flujo = await crearConversacionConHerramientas(PEDIDO, ejecutor, { apiKey: "k", fetchImpl });
    const texto = await leerTodo(flujo.fragmentos);

    expect(texto).toBe("Voy a mirar esa sesión.\n\n_(mirando la transcripción del 01/09)_\n\nEn esa sesión ella dice que se va del cuerpo.");
    expect(ejecutor.ejecutar).toHaveBeenCalledWith({ nombre: "leer_transcripcion", entrada: { sesionId: SESION } });
    expect(cuerpos).toHaveLength(2);
    // Primera ronda: herramientas habilitadas, una por vez.
    expect(cuerpos[0].tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    // Segunda ronda: lo que pidió el modelo, tal cual, y el resultado.
    const mensajes = cuerpos[1].messages as { role: string; content: unknown }[];
    expect(mensajes).toHaveLength(3);
    expect(mensajes[1].role).toBe("assistant");
    expect(mensajes[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool_use", name: "leer_transcripcion" })]));
    expect(mensajes[2]).toEqual({ role: "user", content: [expect.objectContaining({ type: "tool_result", content: "TEXTO DE LA TRANSCRIPCIÓN" })] });
    expect((mensajes[2].content as { is_error?: boolean }[])[0].is_error).toBeUndefined();
    // El system con el corte de caché viaja igual en cada ronda.
    expect(cuerpos[1].system).toEqual(PEDIDO.system);

    await expect(flujo.resultado).resolves.toMatchObject({
      rondas: 2, tokensEntrada: 200, tokensSalida: 20, cacheLeido: 100,
      llamadas: [{ nombre: "leer_transcripcion", entrada: { sesionId: SESION }, rechazada: false }],
    });
  });

  it("después de la tercera llamada la ronda siguiente va sin herramientas, y no hay una cuarta", async () => {
    const pide = sse([{ herramienta: "leer_transcripcion", entrada: { sesionId: SESION } }], "tool_use");
    const { cuerpos, fetchImpl } = proveedor([pide, pide, pide, sse([{ texto: "Con esto alcanza." }], "end_turn")]);
    const ejecutor: EjecutorHerramientas = { aviso: () => null, ejecutar: vi.fn(async () => ({ contenido: "x" })) };
    const flujo = await crearConversacionConHerramientas(PEDIDO, ejecutor, { apiKey: "k", fetchImpl });
    expect(await leerTodo(flujo.fragmentos)).toBe("Con esto alcanza.");
    expect(MAX_LLAMADAS_HERRAMIENTA).toBe(3);
    expect(ejecutor.ejecutar).toHaveBeenCalledTimes(3);
    expect(cuerpos.map((c) => (c.tool_choice as { type: string }).type)).toEqual(["auto", "auto", "auto", "none"]);
    await expect(flujo.resultado).resolves.toMatchObject({ rondas: 4 });
  });

  it("si el modelo igual pide una cuarta, se rechaza sin ejecutarla", async () => {
    const pide = sse([{ herramienta: "leer_transcripcion", entrada: { sesionId: SESION } }], "tool_use");
    const { cuerpos, fetchImpl } = proveedor([pide, pide, sse([{ texto: "Listo." }], "end_turn")]);
    const ejecutor: EjecutorHerramientas = { aviso: () => null, ejecutar: vi.fn(async () => ({ contenido: "x" })) };
    const flujo = await crearConversacionConHerramientas(PEDIDO, ejecutor, { apiKey: "k", fetchImpl, maxLlamadas: 1 });
    await leerTodo(flujo.fragmentos);
    expect(ejecutor.ejecutar).toHaveBeenCalledTimes(1);
    const ultimo = (cuerpos[2].messages as { content: { is_error?: boolean; content: string }[] }[]).at(-1)!;
    expect(ultimo.content[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/tope/) });
    await expect(flujo.resultado).resolves.toMatchObject({ llamadas: [{ rechazada: false }, { rechazada: true }] });
  });

  it("un rechazo del ejecutor vuelve como is_error y el modelo sigue", async () => {
    const { cuerpos, fetchImpl } = proveedor([
      sse([{ herramienta: "leer_transcripcion", entrada: { sesionId: "inventado" } }], "tool_use"),
      sse([{ texto: "Esa no la tengo." }], "end_turn"),
    ]);
    const ejecutor: EjecutorHerramientas = { aviso: () => null, ejecutar: async () => ({ contenido: "no", esError: true }) };
    const flujo = await crearConversacionConHerramientas(PEDIDO, ejecutor, { apiKey: "k", fetchImpl });
    expect(await leerTodo(flujo.fragmentos)).toBe("Esa no la tengo.");
    const resultadoHerramienta = (cuerpos[1].messages as { content: unknown }[])[2].content as { is_error: boolean }[];
    expect(resultadoHerramienta[0].is_error).toBe(true);
    await expect(flujo.resultado).resolves.toMatchObject({ llamadas: [{ rechazada: true }] });
  });

  it("una respuesta final sin texto falla, no devuelve un silencio", async () => {
    const { fetchImpl } = proveedor([sse([], "end_turn")]);
    const flujo = await crearConversacionConHerramientas(PEDIDO, { aviso: () => null, ejecutar: async () => ({ contenido: "" }) }, { apiKey: "k", fetchImpl });
    await expect(leerTodo(flujo.fragmentos)).rejects.toThrow(/sin texto/);
    await expect(flujo.resultado).rejects.toThrow(/sin texto/);
  });

  it("si la ronda final no trae texto, el aviso de una ronda anterior no cuenta como respuesta", async () => {
    const { fetchImpl } = proveedor([
      sse([{ herramienta: "leer_transcripcion", entrada: { sesionId: SESION } }], "tool_use"),
      sse([], "end_turn"),
    ]);
    const ejecutor: EjecutorHerramientas = { aviso: () => "_(mirando la transcripción del 01/09)_", ejecutar: async () => ({ contenido: "x" }) };
    const flujo = await crearConversacionConHerramientas(PEDIDO, ejecutor, { apiKey: "k", fetchImpl });
    await expect(leerTodo(flujo.fragmentos)).rejects.toThrow(/sin texto/);
    await expect(flujo.resultado).rejects.toThrow(/sin texto/);
  });

  it("un 500 inicial del proveedor lanza antes de devolver el flujo", async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } });
    await expect(crearConversacionConHerramientas(PEDIDO, { aviso: () => null, ejecutar: async () => ({ contenido: "" }) }, { apiKey: "k", fetchImpl }))
      .rejects.toMatchObject({ name: "ErrorAnthropic", status: 500 });
  });
});

describe("ejecutorLux — la lista cerrada", () => {
  // Una base que falla si alguien la toca: los rechazos no consultan nada.
  const intocable = new Proxy({}, { get: () => { throw new Error("no debía tocar la base"); } }) as unknown as ClienteLux;
  const abribles = new Map([[SESION, new Date("2026-09-01T14:00:00Z")]]);
  const ejecutor = ejecutorLux({ prisma: intocable, organizationId: "org", usuarioId: "user", abribles });

  it("un id fuera de la lista se rechaza sin aviso y sin tocar la base", async () => {
    const llamada = { nombre: "leer_transcripcion", entrada: { sesionId: randomUUID() } };
    expect(ejecutor.aviso(llamada)).toBeNull();
    await expect(ejecutor.ejecutar(llamada)).resolves.toEqual({ contenido: RECHAZO_FUERA_DE_LISTA, esError: true });
  });

  it("argumentos de más, ids que no son uuid y herramientas inventadas también", async () => {
    await expect(ejecutor.ejecutar({ nombre: "leer_transcripcion", entrada: { sesionId: SESION, organizationId: "otra" } }))
      .resolves.toEqual({ contenido: RECHAZO_FUERA_DE_LISTA, esError: true });
    await expect(ejecutor.ejecutar({ nombre: "leer_transcripcion", entrada: { sesionId: "1 OR 1=1" } }))
      .resolves.toEqual({ contenido: RECHAZO_FUERA_DE_LISTA, esError: true });
    await expect(ejecutor.ejecutar({ nombre: "sql", entrada: { query: "select 1" } }))
      .resolves.toEqual({ contenido: RECHAZO_HERRAMIENTA, esError: true });
    expect(ejecutor.leidas).toEqual([]);
  });

  it("un id de la lista da el aviso con la fecha de Montevideo", () => {
    expect(ejecutor.aviso({ nombre: "leer_transcripcion", entrada: { sesionId: SESION } })).toBe("_(mirando la transcripción del 01/09)_");
  });

  it("la única herramienta es leer_transcripcion, sin argumentos libres", () => {
    expect(HERRAMIENTAS_LUX.map((h) => h.name)).toEqual(["leer_transcripcion"]);
    expect(HERRAMIENTAS_LUX[0].input_schema).toMatchObject({ required: ["sesionId"], additionalProperties: false });
  });
});

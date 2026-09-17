import { describe, expect, it, vi } from "vitest";
import { HERRAMIENTAS_AYUDA, resolverHerramienta } from "@/app/api/_lib/casos-uso/ayuda/herramientas";
import { responderAyuda, responderAyudaStreaming } from "@/app/api/_lib/casos-uso/responder-ayuda";
import { crearMensajeStreaming, type PedidoMensajes, type ResultadoMensajes } from "@/lib/anthropic-mensajes";
import { AYUDA_AGENDA_VACIA, AYUDA_FUERA_DE_ALCANCE } from "@/lib/glosario";

const resultado = (nombre = "consultar_agenda", entrada: unknown = { periodo: "hoy" }): ResultadoMensajes => ({
  texto: "", tokensEntrada: 10, tokensSalida: 20, cacheLeido: 30, cacheEscrito: 0,
  motivoDeCorte: "tool_use", herramientas: [{ nombre, entrada }],
});
const vacia = async () => [];

describe("herramientas cerradas de Lupita", () => {
  it.each(["hoy", "manana", "esta_semana"])("valida %s y devuelve la agenda vacía sin inventar", async periodo => {
    const consultar = vi.fn(vacia);
    expect(await resolverHerramienta(resultado("consultar_agenda", { periodo }), consultar)).toContain(AYUDA_AGENDA_VACIA);
    expect(consultar).toHaveBeenCalledExactlyOnceWith(periodo);
  });
  it.each([null, [], "hoy", {}, { periodo: "ayer" }, { periodo: "2026-09-17" }, { periodo: "hoy", select: { telefono: true } }])(
    "rechaza argumentos malformados o períodos ajenos: %j", async entrada => {
      const consultar = vi.fn(vacia);
      expect(await resolverHerramienta(resultado("consultar_agenda", entrada), consultar)).toBe(AYUDA_FUERA_DE_ALCANCE);
      expect(consultar).not.toHaveBeenCalled();
    },
  );
  it("rechaza llamadas múltiples o truncadas sin ejecutar ni la primera", async () => {
    const consultar = vi.fn(vacia);
    const original = resultado();
    for (const pedido of [
      { ...original, herramientas: [...original.herramientas!, ...original.herramientas!] },
      { ...original, motivoDeCorte: "max_tokens" },
    ]) expect(await resolverHerramienta(pedido, consultar)).toBe(AYUDA_FUERA_DE_ALCANCE);
    expect(consultar).not.toHaveBeenCalled();
  });
  it("la negativa es explícita y no consulta la base", async () => {
    const consultar = vi.fn(vacia);
    expect(await resolverHerramienta(resultado("fuera_de_alcance", {}), consultar)).toBe(AYUDA_FUERA_DE_ALCANCE);
    for (const limite of ["teléfonos", "tarifas", "deudas", "cobros", "notas", "transcripciones", "Recorrido", "consentimientos", "fichas", "otro consultorio", "cancelar"]) expect(AYUDA_FUERA_DE_ALCANCE).toContain(limite);
    expect(consultar).not.toHaveBeenCalled();
  });
  it("un fallo de lectura no se disfraza de agenda vacía", async () => {
    await expect(resolverHerramienta(resultado(), async () => { throw new Error("base desconectada"); })).rejects.toThrow("base desconectada");
  });
  it("sin llamada no consulta datos", async () => {
    const consultar = vi.fn(vacia);
    expect(await resolverHerramienta({ ...resultado(), herramientas: undefined }, consultar)).toBeNull();
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("el caso de uso con la capacidad de agenda", () => {
  it("manda solo las dos herramientas cerradas, respeta el historial y no manda la agenda al proveedor", async () => {
    const crear = vi.fn(async () => resultado("consultar_agenda", { periodo: "manana" }));
    const consultarAgenda = vi.fn(async () => [{ nombre: "PACIENTE_DE_PRUEBA", dia: "2026-09-18", hora: "15:15", duracion: 50, modalidad: "online" as const }]);
    const respuesta = await responderAyuda({
      pregunta: "¿y mañana?", historial: [{ rol: "usuaria", texto: "¿Qué turnos tengo hoy?" }],
      apiKey: "prueba", systemPrompt: "ayuda", crear, consultarAgenda,
    });
    expect(consultarAgenda).toHaveBeenCalledExactlyOnceWith("manana");
    expect(respuesta.respuesta).toContain("2026-09-18 · 15:15 · PACIENTE_DE_PRUEBA · 50 min · online");
    expect(crear).toHaveBeenCalledTimes(1);
    const pedido = crear.mock.calls[0] as unknown as [PedidoMensajes];
    expect(pedido[0].tools).toEqual(HERRAMIENTAS_AYUDA);
    expect(pedido[0].tools?.map(h => h.name)).toEqual(["consultar_agenda", "fuera_de_alcance"]);
    expect(pedido[0].tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(JSON.stringify(pedido)).not.toContain("PACIENTE_DE_PRUEBA");
    expect(respuesta.tokensEntrada).toBe(10);
  });
  it("no corta un listado largo por el límite de tokens del modelo", async () => {
    const respuesta = await responderAyuda({ pregunta: "Turnos esta semana", apiKey: "prueba", systemPrompt: "ayuda",
      crear: async () => resultado("consultar_agenda", { periodo: "esta_semana" }),
      consultarAgenda: async () => Array.from({ length: 100 }, (_, i) => ({ nombre: `Paciente ${i}`, dia: "2026-09-18", hora: "10:00", duracion: 50, modalidad: "presencial" })),
    });
    expect(respuesta.respuesta.split("\n")).toHaveLength(101);
    expect(respuesta.respuesta).toContain("Paciente 99");
  });
  it("lee tool_use real del SDK por SSE y muestra el listado, con métricas y una sola consulta", async () => {
    const eventos = [
      { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [], model: "claude-sonnet-5", stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_test", name: "consultar_agenda", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"periodo":"hoy"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const consultarAgenda = vi.fn(vacia);
    const flujo = await responderAyudaStreaming({ pregunta: "¿Quién viene hoy?", apiKey: "prueba", systemPrompt: "ayuda", consultarAgenda,
      crearStreaming: (pedido, opciones) => crearMensajeStreaming(pedido, { ...opciones, fetchImpl: async () => new Response(eventos, { headers: { "content-type": "text/event-stream" } }) }),
    });
    let texto = "";
    for await (const parte of flujo.fragmentos) texto += parte;
    expect(texto).toContain(AYUDA_AGENDA_VACIA);
    expect(consultarAgenda).toHaveBeenCalledExactlyOnceWith("hoy");
    await expect(flujo.resultado).resolves.toMatchObject({ texto, tokensEntrada: 10, tokensSalida: 20 });
  });
  it("mantiene la ayuda incremental sin consultar agenda", async () => {
    const consultarAgenda = vi.fn(vacia);
    let continuar!: () => void;
    const espera = new Promise<void>(resolve => { continuar = resolve; });
    const flujo = await responderAyudaStreaming({ pregunta: "¿Cómo cobro?", apiKey: "prueba", systemPrompt: "ayuda", consultarAgenda,
      crearStreaming: async () => ({
        fragmentos: (async function* () { yield "Entrá "; await espera; yield "a Cobros"; })(),
        resultado: espera.then(() => ({ ...resultado(), texto: "Entrá a Cobros", herramientas: undefined, motivoDeCorte: "end_turn" })), cancelar: vi.fn(),
      }),
    });
    const lector = flujo.fragmentos[Symbol.asyncIterator]();
    expect(await lector.next()).toEqual({ done: false, value: "Entrá " });
    continuar();
    expect((await lector.next()).value).toBe("a Cobros");
    expect((await lector.next()).done).toBe(true);
    expect(consultarAgenda).not.toHaveBeenCalled();
  });
  it("cancelar antes de completar la decisión no consulta la agenda", async () => {
    const consultarAgenda = vi.fn(vacia);
    const cancelar = vi.fn();
    const flujo = await responderAyudaStreaming({ pregunta: "Turnos hoy", apiKey: "prueba", systemPrompt: "ayuda", consultarAgenda,
      crearStreaming: async () => ({ fragmentos: (async function* () {})(), resultado: Promise.resolve(resultado()), cancelar }),
    });
    flujo.cancelar();
    for await (const parte of flujo.fragmentos) throw new Error(parte);
    await expect(flujo.resultado).rejects.toThrow("cancelada");
    expect(cancelar).toHaveBeenCalledOnce();
    expect(consultarAgenda).not.toHaveBeenCalled();
  });
});

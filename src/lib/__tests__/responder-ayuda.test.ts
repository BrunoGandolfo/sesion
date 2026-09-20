import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  crearMensajeStreaming,
  FlujoMensajes,
  PedidoMensajes,
  ResultadoMensajes,
} from "@/lib/anthropic-mensajes";
import { MODELO_AYUDA } from "@/lib/anthropic-mensajes";

import { ApiError } from "@/app/api/_lib/responses";
import {
  historialAMensajes,
  LARGO_MAX_PREGUNTA,
  MAX_TOKENS_RESPUESTA,
  MAX_TURNOS_HISTORIAL,
  MENSAJE_PROVEEDOR_CAIDO,
  MENSAJE_SIN_CLAVE,
  responderAyudaStreaming,
  type TurnoAyuda,
} from "@/app/api/_lib/casos-uso/responder-ayuda";

const CLAVE = "sk-ant-de-prueba";
const SYSTEM = "system prompt de mentira";

const RESULTADO_OK = {
  texto: "Entrá a “Agenda”, tocá el turno y después “Cobrar”.",
  tokensEntrada: 40,
  tokensSalida: 60,
  cacheLeido: 20_000,
  cacheEscrito: 0,
  motivoDeCorte: "end_turn" as const,
};

/** Doble de crearMensajeStreaming que guarda el pedido y contesta fijo, en
 *  un solo fragmento. */
function proveedorQueContesta(resultado: ResultadoMensajes = RESULTADO_OK) {
  const pedidos: PedidoMensajes[] = [];
  const crear: typeof crearMensajeStreaming = async (pedido) => {
    pedidos.push(pedido);
    return flujoDe(resultado);
  };
  return { crear, pedidos };
}

function flujoDe(resultado: ResultadoMensajes): FlujoMensajes {
  async function* fragmentos() {
    yield resultado.texto;
  }
  return { fragmentos: fragmentos(), resultado: Promise.resolve(resultado), cancelar: () => {} };
}

/** Lo que la usuaria termina viendo, y las métricas del flujo. */
async function consumir(flujo: FlujoMensajes) {
  let texto = "";
  for await (const parte of flujo.fragmentos) texto += parte;
  const { tokensEntrada, tokensSalida, cacheLeido } = await flujo.resultado;
  return { respuesta: texto, tokensEntrada, tokensSalida, cacheLeido };
}

/** Doble de crearMensajeStreaming que se cae. */
const proveedorCaido: typeof crearMensajeStreaming = async () => {
  throw new Error("HTTP 529: overloaded — este texto NO puede salir a la app");
};

// console.warn/error se silencian: los caminos de error loguean a propósito
// y no hace falta ensuciar la salida del test.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────

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

describe("historialAMensajes", () => {
  const turno = (i: number): TurnoAyuda => ({
    rol: i % 2 === 0 ? "usuaria" : "asistente",
    texto: `turno ${i}`,
  });

  it("traduce los roles", () => {
    expect(
      historialAMensajes([
        { rol: "usuaria", texto: "hola" },
        { rol: "asistente", texto: "buenas" },
      ]),
    ).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "buenas" },
    ]);
  });

  it("se queda con los ÚLTIMOS 6 turnos", () => {
    const largo = Array.from({ length: 20 }, (_, i) => turno(i));
    const mensajes = historialAMensajes(largo);

    expect(mensajes).toHaveLength(MAX_TURNOS_HISTORIAL);
    expect(mensajes[mensajes.length - 1].content).toBe("turno 19");
    expect(mensajes[0].content).toBe("turno 14");
  });

  it("descarta los turnos vacíos, que la API rechaza", () => {
    expect(
      historialAMensajes([
        { rol: "usuaria", texto: "   " },
        { rol: "usuaria", texto: "algo" },
      ]),
    ).toEqual([{ role: "user", content: "algo" }]);
  });
});

describe("responderAyudaStreaming — validación", () => {
  it("400 con la pregunta vacía", async () => {
    await expect(
      responderAyudaStreaming({ pregunta: "   ", apiKey: CLAVE, systemPrompt: SYSTEM }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 pasados los 600 caracteres", async () => {
    await expect(
      responderAyudaStreaming({
        pregunta: "a".repeat(LARGO_MAX_PREGUNTA + 1),
        apiKey: CLAVE,
        systemPrompt: SYSTEM,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("600 justos pasan", async () => {
    const { crear } = proveedorQueContesta();
    const flujo = await responderAyudaStreaming({
      pregunta: "a".repeat(LARGO_MAX_PREGUNTA),
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: crear,
    });
    expect(await consumir(flujo)).toMatchObject({ respuesta: RESULTADO_OK.texto });
  });
});

describe("responderAyudaStreaming — sin clave", () => {
  it("503 con mensaje para la usuaria, sin llamar al proveedor", async () => {
    const { crear, pedidos } = proveedorQueContesta();

    const error = await atrapar<ApiError>(
      responderAyudaStreaming({
        pregunta: "¿cómo cobro?",
        apiKey: "",
        systemPrompt: SYSTEM,
        crearStreaming: crear,
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.message).toBe(MENSAJE_SIN_CLAVE);
    expect(pedidos).toHaveLength(0);
  });

  it("cae a ANTHROPIC_API_KEY cuando no se pasa una", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        responderAyudaStreaming({ pregunta: "¿cómo cobro?", systemPrompt: SYSTEM }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe("responderAyudaStreaming — el proveedor falla", () => {
  it("502 y el detalle interno NO sale en el mensaje", async () => {
    const error = await atrapar<ApiError>(
      responderAyudaStreaming({
        pregunta: "¿cómo cobro?",
        apiKey: CLAVE,
        systemPrompt: SYSTEM,
        crearStreaming: proveedorCaido,
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(MENSAJE_PROVEEDOR_CAIDO);
    expect(error.message).not.toContain("529");
    expect(error.message).not.toContain("overloaded");
  });

  it("el detalle sí va al log", async () => {
    await responderAyudaStreaming({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: proveedorCaido,
    }).catch(() => undefined);

    expect(console.error).toHaveBeenCalledWith(
      "[ayuda] fallo del proveedor",
      expect.any(Error),
    );
  });
});

describe("responderAyudaStreaming — el pedido que arma", () => {
  it("usa Haiku 4.5 y el techo de tokens", async () => {
    const { crear, pedidos } = proveedorQueContesta();
    await responderAyudaStreaming({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: crear,
    });

    expect(pedidos[0].model).toBe(MODELO_AYUDA);
    expect(MODELO_AYUDA).toBe("claude-sonnet-5");
    expect(pedidos[0].max_tokens).toBe(MAX_TOKENS_RESPUESTA);
  });

  it("el system va cacheado y la pregunta DESPUÉS, en messages", async () => {
    const { crear, pedidos } = proveedorQueContesta();
    await responderAyudaStreaming({
      pregunta: "¿cómo cobro un turno?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: crear,
    });

    expect(pedidos[0].system).toEqual([
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ]);
    expect(pedidos[0].messages).toEqual([
      { role: "user", content: "¿cómo cobro un turno?" },
    ]);
  });

  it("el historial va antes de la pregunta nueva", async () => {
    const { crear, pedidos } = proveedorQueContesta();
    await responderAyudaStreaming({
      pregunta: "¿y si no me anduvo?",
      historial: [
        { rol: "usuaria", texto: "¿cómo cobro?" },
        { rol: "asistente", texto: "Entrá a Agenda…" },
      ],
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: crear,
    });

    expect(pedidos[0].messages).toEqual([
      { role: "user", content: "¿cómo cobro?" },
      { role: "assistant", content: "Entrá a Agenda…" },
      { role: "user", content: "¿y si no me anduvo?" },
    ]);
  });

  it("entrega la respuesta por fragmentos y las métricas del flujo", async () => {
    const { crear } = proveedorQueContesta();
    const flujo = await responderAyudaStreaming({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crearStreaming: crear,
    });

    expect(await consumir(flujo)).toEqual({
      respuesta: RESULTADO_OK.texto,
      tokensEntrada: 40,
      tokensSalida: 60,
      cacheLeido: 20_000,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────

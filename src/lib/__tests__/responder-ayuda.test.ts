// Unitario — el caso de uso de la ayuda y el tope diario.
//
// Sin red y sin base: la llamada a Anthropic entra como parámetro y el
// cliente Prisma es un doble que solo sabe contar (mismo patrón que
// salud.test.ts). Lo que se prueba son las decisiones:
//
//   - sin clave configurada, 503 con un mensaje para la usuaria;
//   - si el proveedor falla, 502 y NADA del error interno en el mensaje;
//   - el historial se recorta a los últimos 6 turnos;
//   - el corpus va en el system, cacheado, y la pregunta después;
//   - el tope diario se cuenta sobre eventos_auditoria del día de Montevideo.
//
// El tope no necesita base: lo que hay que verificar es el WHERE que se le
// pide a Prisma —accion, entidad, entidadId y el borde del día—, y eso se ve
// mejor con un doble que contra una tabla vacía. El tipo del parámetro es el
// cliente real, así que tsc igual chequea que la consulta exista.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { crearMensaje, PedidoMensajes } from "@/lib/anthropic-mensajes";
import { MODELO_AYUDA } from "@/lib/anthropic-mensajes";
import { instanteMvd } from "@/lib/fechas-montevideo";

import { ApiError } from "@/app/api/_lib/responses";
import {
  ACCION_AYUDA,
  assertBajoElTope,
  contarPreguntasDelDia,
  ENTIDAD_AYUDA,
  historialAMensajes,
  LARGO_MAX_PREGUNTA,
  MAX_TOKENS_RESPUESTA,
  MAX_TURNOS_HISTORIAL,
  MENSAJE_PROVEEDOR_CAIDO,
  MENSAJE_SIN_CLAVE,
  MENSAJE_TOPE_DIARIO,
  responderAyuda,
  TOPE_PREGUNTAS_DIA,
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

/** Doble de crearMensaje que guarda el pedido y contesta fijo. */
function proveedorQueContesta(resultado = RESULTADO_OK) {
  const pedidos: PedidoMensajes[] = [];
  const crear: typeof crearMensaje = async (pedido) => {
    pedidos.push(pedido);
    return resultado;
  };
  return { crear, pedidos };
}

/** Doble de crearMensaje que se cae. */
const proveedorCaido: typeof crearMensaje = async () => {
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

describe("responderAyuda — validación", () => {
  it("400 con la pregunta vacía", async () => {
    await expect(
      responderAyuda({ pregunta: "   ", apiKey: CLAVE, systemPrompt: SYSTEM }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 pasados los 600 caracteres", async () => {
    await expect(
      responderAyuda({
        pregunta: "a".repeat(LARGO_MAX_PREGUNTA + 1),
        apiKey: CLAVE,
        systemPrompt: SYSTEM,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("600 justos pasan", async () => {
    const { crear } = proveedorQueContesta();
    await expect(
      responderAyuda({
        pregunta: "a".repeat(LARGO_MAX_PREGUNTA),
        apiKey: CLAVE,
        systemPrompt: SYSTEM,
        crear,
      }),
    ).resolves.toMatchObject({ respuesta: RESULTADO_OK.texto });
  });
});

describe("responderAyuda — sin clave", () => {
  it("503 con mensaje para la usuaria, sin llamar al proveedor", async () => {
    const { crear, pedidos } = proveedorQueContesta();

    const error = await atrapar<ApiError>(
      responderAyuda({
        pregunta: "¿cómo cobro?",
        apiKey: "",
        systemPrompt: SYSTEM,
        crear,
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
        responderAyuda({ pregunta: "¿cómo cobro?", systemPrompt: SYSTEM }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe("responderAyuda — el proveedor falla", () => {
  it("502 y el detalle interno NO sale en el mensaje", async () => {
    const error = await atrapar<ApiError>(
      responderAyuda({
        pregunta: "¿cómo cobro?",
        apiKey: CLAVE,
        systemPrompt: SYSTEM,
        crear: proveedorCaido,
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(MENSAJE_PROVEEDOR_CAIDO);
    expect(error.message).not.toContain("529");
    expect(error.message).not.toContain("overloaded");
  });

  it("el detalle sí va al log", async () => {
    await responderAyuda({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crear: proveedorCaido,
    }).catch(() => undefined);

    expect(console.error).toHaveBeenCalledWith(
      "[ayuda] fallo del proveedor",
      expect.any(Error),
    );
  });
});

describe("responderAyuda — el pedido que arma", () => {
  it("usa Haiku 4.5 y el techo de tokens", async () => {
    const { crear, pedidos } = proveedorQueContesta();
    await responderAyuda({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crear,
    });

    expect(pedidos[0].model).toBe(MODELO_AYUDA);
    expect(MODELO_AYUDA).toBe("claude-haiku-4-5");
    expect(pedidos[0].max_tokens).toBe(MAX_TOKENS_RESPUESTA);
  });

  it("el system va cacheado y la pregunta DESPUÉS, en messages", async () => {
    const { crear, pedidos } = proveedorQueContesta();
    await responderAyuda({
      pregunta: "¿cómo cobro un turno?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crear,
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
    await responderAyuda({
      pregunta: "¿y si no me anduvo?",
      historial: [
        { rol: "usuaria", texto: "¿cómo cobro?" },
        { rol: "asistente", texto: "Entrá a Agenda…" },
      ],
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crear,
    });

    expect(pedidos[0].messages).toEqual([
      { role: "user", content: "¿cómo cobro?" },
      { role: "assistant", content: "Entrá a Agenda…" },
      { role: "user", content: "¿y si no me anduvo?" },
    ]);
  });

  it("devuelve la respuesta y las métricas, sin el resto del resultado", async () => {
    const { crear } = proveedorQueContesta();
    const r = await responderAyuda({
      pregunta: "¿cómo cobro?",
      apiKey: CLAVE,
      systemPrompt: SYSTEM,
      crear,
    });

    expect(r).toEqual({
      respuesta: RESULTADO_OK.texto,
      tokensEntrada: 40,
      tokensSalida: 60,
      cacheLeido: 20_000,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// El tope diario
// ────────────────────────────────────────────────────────────────────────────

type WhereContado = Record<string, unknown>;

/** Doble de Prisma que solo cuenta y guarda el where que le pidieron. */
function prismaQueCuenta(cantidad: number) {
  const wheres: WhereContado[] = [];
  const prisma = {
    eventoAuditoria: {
      count: async ({ where }: { where: WhereContado }) => {
        wheres.push(where);
        return cantidad;
      },
    },
  };
  return {
    // El caso de uso pide el cliente entero; acá solo se usa una consulta.
    prisma: prisma as unknown as Parameters<typeof contarPreguntasDelDia>[0],
    wheres,
  };
}

describe("contarPreguntasDelDia", () => {
  it("cuenta la acción, la entidad y la usuaria correctas", async () => {
    const { prisma, wheres } = prismaQueCuenta(3);
    const total = await contarPreguntasDelDia(prisma, {
      organizationId: "org1",
      userId: "u1",
      ahora: new Date("2026-09-07T15:00:00.000Z"),
    });

    expect(total).toBe(3);
    expect(wheres[0]).toMatchObject({
      organizationId: "org1",
      accion: ACCION_AYUDA,
      entidad: ENTIDAD_AYUDA,
      entidadId: "u1",
    });
    expect(ACCION_AYUDA).toBe("ayuda.pregunta");
    expect(ENTIDAD_AYUDA).toBe("usuario");
  });

  it("el día empieza a la medianoche de MONTEVIDEO, no de UTC", async () => {
    const { prisma, wheres } = prismaQueCuenta(0);
    // 01:00 UTC del 8 son las 22:00 del 7 en Montevideo: el día que cuenta
    // es el 7, no el 8. Con `new Date().setHours(0)` esto daría el 8 y el
    // tope se reiniciaría a las 21:00 de la noche.
    await contarPreguntasDelDia(prisma, {
      organizationId: "org1",
      userId: "u1",
      ahora: new Date("2026-09-08T01:00:00.000Z"),
    });

    const rango = wheres[0].createdAt as { gte: Date };
    expect(rango.gte).toEqual(instanteMvd(2026, 8, 7));
  });
});

describe("assertBajoElTope", () => {
  const params = { organizationId: "org1", userId: "u1" };

  it("deja pasar con 39 preguntas", async () => {
    const { prisma } = prismaQueCuenta(TOPE_PREGUNTAS_DIA - 1);
    await expect(assertBajoElTope(prisma, params)).resolves.toBeUndefined();
  });

  it("429 amable justo en el tope", async () => {
    const { prisma } = prismaQueCuenta(TOPE_PREGUNTAS_DIA);
    const error = await atrapar<ApiError>(assertBajoElTope(prisma, params));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.message).toBe(MENSAJE_TOPE_DIARIO);
    expect(error.message).toContain("Mañana se renueva");
  });

  it("el tope son 40", () => {
    expect(TOPE_PREGUNTAS_DIA).toBe(40);
  });
});

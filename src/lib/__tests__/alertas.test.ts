// Unitario — la única salida de alertas del sistema.
//
// Sin red: el fetch es un doble. Lo que se prueba es el contrato: que el
// correo va a ALERTA_CORREO, que se reintenta, que si no sale cae a Sentry y
// al log (y nunca lanza), y que el detalle no puede llevar un teléfono.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  cliente: null as object | null,
  mensajes: [] as string[],
}));

vi.mock("@sentry/nextjs", () => ({
  getClient: () => sentry.cliente,
  captureMessage: (m: string) => {
    sentry.mensajes.push(m);
  },
}));

import { alertar, armarAlerta, ESPERAS_MS, INTENTOS_ALERTA } from "@/lib/alertas";

const AHORA = new Date("2026-09-11T15:00:00.000Z");
const ENV = { ALERTA_CORREO: "duenio@ejemplo.test", RESEND_API_KEY: "re_prueba" };

/** Un fetch que contesta según la lista: cada entrada es un status HTTP o
 *  "red" para simular un fallo de conexión. */
function fetchFalso(respuestas: Array<number | "red">) {
  const llamadas: Array<{ url: string; body: unknown }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = respuestas.shift() ?? 200;
    if (r === "red") throw new TypeError("fetch failed");
    return new Response("{}", { status: r });
  });
  return { fetcher: fetcher as unknown as typeof fetch, llamadas };
}

const sinEspera = async () => {};

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sentry.cliente = null;
  sentry.mensajes = [];
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
});

describe("armarAlerta", () => {
  it("asunto con el nivel y cuerpo con el detalle y la hora", () => {
    const { asunto, texto } = armarAlerta("critico", "El worker está caído", { edad: 900 }, AHORA);
    expect(asunto).toBe("[Sesión] CRÍTICO: El worker está caído");
    expect(texto).toContain("edad: 900");
    expect(texto).toContain("2026-09-11T15:00:00.000Z");
  });

  it("un aviso se llama Aviso", () => {
    expect(armarAlerta("aviso", "x", undefined, AHORA).asunto).toBe("[Sesión] Aviso: x");
  });

  it("el detalle no puede llevar teléfono, nombre ni texto clínico", () => {
    // Misma lista negra que la auditoría: el correo sale del sistema.
    const { texto } = armarAlerta(
      "aviso",
      "SMS fallido",
      { telefono: "+59899123456", nombre: "Lucía", envioId: "e1", nota: "…" },
      AHORA,
    );
    expect(texto).not.toContain("+59899123456");
    expect(texto).not.toContain("Lucía");
    expect(texto).toContain("envioId: e1");
  });

  it("el html es el texto escapado, nada más", () => {
    const { html } = armarAlerta("aviso", "<b>", undefined, AHORA);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("alertar", () => {
  it("manda el correo a ALERTA_CORREO por Resend y devuelve true", async () => {
    const { fetcher, llamadas } = fetchFalso([200]);

    const ok = await alertar("aviso", "Prueba", { n: 1 }, { fetcher, env: ENV, ahora: AHORA, esperar: sinEspera });

    expect(ok).toBe(true);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.resend.com/emails");
    expect(llamadas[0].body).toMatchObject({
      to: ["duenio@ejemplo.test"],
      subject: "[Sesión] Aviso: Prueba",
    });
    expect(sentry.mensajes).toEqual([]);
  });

  it("reintenta cuando el proveedor falla y sale en el segundo intento", async () => {
    const { fetcher, llamadas } = fetchFalso([500, 200]);
    const esperas: number[] = [];

    const ok = await alertar("aviso", "Prueba", undefined, {
      fetcher, env: ENV, ahora: AHORA,
      esperar: async (ms) => { esperas.push(ms); },
    });

    expect(ok).toBe(true);
    expect(llamadas).toHaveLength(2);
    expect(esperas).toEqual([ESPERAS_MS[0]]);
  });

  it("si nunca sale: false, al log y a Sentry; no lanza", async () => {
    sentry.cliente = {};
    const { fetcher, llamadas } = fetchFalso(["red", 502, "red"]);

    const ok = await alertar("critico", "La base no responde", { error: "x" }, {
      fetcher, env: ENV, ahora: AHORA, esperar: sinEspera,
    });

    expect(ok).toBe(false);
    expect(llamadas).toHaveLength(INTENTOS_ALERTA);
    expect(sentry.mensajes).toHaveLength(1);
    expect(sentry.mensajes[0]).toContain("[Sesión] CRÍTICO: La base no responde");
    // Y el contenido de la alerta quedó en el log, no se perdió.
    const logueado = error.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logueado).toContain("La base no responde");
    expect(logueado).toContain("error: x");
  });

  it("sin ALERTA_CORREO no llama al proveedor: log y Sentry", async () => {
    sentry.cliente = {};
    const { fetcher, llamadas } = fetchFalso([200]);

    const ok = await alertar("aviso", "Prueba", undefined, {
      fetcher, env: { RESEND_API_KEY: "re_x" }, ahora: AHORA, esperar: sinEspera,
    });

    expect(ok).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect(sentry.mensajes[0]).toContain("falta ALERTA_CORREO");
  });

  it("sin Sentry inicializado tampoco lanza", async () => {
    sentry.cliente = null;
    const { fetcher } = fetchFalso(["red", "red", "red"]);
    await expect(
      alertar("aviso", "Prueba", undefined, { fetcher, env: ENV, esperar: sinEspera }),
    ).resolves.toBe(false);
  });
});

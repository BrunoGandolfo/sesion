/**
 * Integración — las rutas que no llama una persona: los crons de Vercel
 * (CRON_SECRET), el reclamo del worker (PROCESSING_SECRET) y los dos
 * semáforos públicos del monitor (/health, /estado-worker).
 *
 * Ninguna la cargaba un test: sus casos de uso sí tienen los suyos, pero la
 * puerta —quién entra— no la probaba nadie. Acá se prueba la respuesta, no
 * el código: sin credencial o con la equivocada, 401; con la correcta, 200
 * contra una base vacía. Y los semáforos: 200 cuando está todo bien, 503
 * cuando no.
 *
 * Las rutas se importan después de poner el cliente de test en el cache
 * global que lee src/lib/db.ts (el mismo truco que multi-tenant.test.ts).
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas } from "./db-test";

type Get = (request: Request) => Promise<Response>;

const CRON = "secreto-del-cron-de-prueba";
const M2M = "secreto-del-worker-de-prueba";

// Qué credencial abre cada ruta. El nombre es el path bajo /api.
const PROTEGIDAS = [
  { ruta: "cron/trabajos", secreto: CRON },
  { ruta: "cron/mantenimiento", secreto: CRON },
  { ruta: "cron/recordatorios", secreto: CRON },
  { ruta: "cron/salud", secreto: CRON },
  { ruta: "trabajos/pendientes", secreto: M2M },
  { ruta: "sesion-clinica/pendientes", secreto: M2M },
] as const;

let prismaRaw!: PrismaClient;
const rutas = new Map<string, Get>();
const CLAVE_ORIGINAL = process.env.CLAVES_CIFRADO;

function pedido(ruta: string, bearer?: string): Request {
  return new Request(`http://localhost/api/${ruta}`, {
    headers: bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` },
  });
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${randomBytes(32).toString("base64")}`;
  __resetLlaveroForTests();
  const conexion = conectarBaseDeTest();
  prismaRaw = conexion.prisma;
  (globalThis as unknown as { prisma: unknown }).prisma = conexion.db;
  for (const ruta of [...PROTEGIDAS.map((p) => p.ruta), "health", "estado-worker"]) {
    const modulo = (await import(/* @vite-ignore */ `@/app/api/${ruta}/route`)) as { GET: Get };
    rutas.set(ruta, modulo.GET);
  }
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("PROCESSING_SECRET", M2M);
  // Nada sale de la máquina: sin correo de alertas, sin Twilio. R2 figura
  // configurado para que cron/trabajos corra; sin trabajos, no lo llama.
  vi.stubEnv("ALERTA_CORREO", "");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "");
  vi.stubEnv("TWILIO_SMS_FROM", "");
  vi.stubEnv("R2_ACCOUNT_ID", "0123456789abcdef");
  vi.stubEnv("R2_ACCESS_KEY_ID", "falsa");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "falsa");
  vi.stubEnv("R2_BUCKET_NAME", "sesion-audio");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (CLAVE_ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = CLAVE_ORIGINAL;
  __resetLlaveroForTests();
});

describe.each(PROTEGIDAS)("GET /api/$ruta", ({ ruta, secreto }) => {
  const otro = secreto === CRON ? M2M : CRON;

  it("sin credencial: 401", async () => {
    expect((await rutas.get(ruta)!(pedido(ruta))).status).toBe(401);
  });

  it("con un secreto equivocado, o con el de la otra puerta: 401", async () => {
    expect((await rutas.get(ruta)!(pedido(ruta, "cualquier-cosa"))).status).toBe(401);
    expect((await rutas.get(ruta)!(pedido(ruta, otro))).status).toBe(401);
  });

  it("sin el secreto configurado no abre para nadie", async () => {
    vi.stubEnv(secreto === CRON ? "CRON_SECRET" : "PROCESSING_SECRET", "");
    expect((await rutas.get(ruta)!(pedido(ruta, secreto))).status).toBe(401);
  });

  it("con la credencial correcta: 200", async () => {
    const res = await rutas.get(ruta)!(pedido(ruta, secreto));
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("GET /api/health", () => {
  it("con la base respondiendo: 200 y un semáforo, sin detalles", async () => {
    const res = await rutas.get("health")!(pedido("health"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("en producción sin las variables de operación: 503, sin decir cuáles", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await rutas.get("health")!(pedido("health"));
    expect(res.status).toBe(503);
    const texto = await res.text();
    expect(JSON.parse(texto)).toEqual({ status: "error" });
    expect(texto).not.toMatch(/ALERTA_CORREO|TWILIO|RESEND/);
  });
});

describe("GET /api/estado-worker", () => {
  it("si el worker nunca pidió trabajo: 503", async () => {
    const res = await rutas.get("estado-worker")!(pedido("estado-worker"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("error");
  });

  it("después de un reclamo del worker: 200", async () => {
    expect((await rutas.get("sesion-clinica/pendientes")!(pedido("sesion-clinica/pendientes", M2M))).status).toBe(200);
    const res = await rutas.get("estado-worker")!(pedido("estado-worker"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("si el último reclamo es viejo: 503", async () => {
    expect((await rutas.get("trabajos/pendientes")!(pedido("trabajos/pendientes", M2M))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
      expect((await rutas.get("estado-worker")!(pedido("estado-worker"))).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});

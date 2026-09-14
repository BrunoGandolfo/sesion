/**
 * Integración — los dos webhooks de Twilio contra la base real de test:
 * /api/sms/callback (estado de entrega) y /api/sms/entrante (la baja).
 *
 * Las rutas usan el `db` global de src/lib/db.ts; se lo apunta a la base de
 * test por el caché de globalThis antes del import dinámico.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5433/sesion_test" \
 *   npx vitest run src/lib/__tests__/sms-callback.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

const alertas = vi.hoisted(() => ({ enviadas: [] as Array<{ nivel: string; titulo: string }> }));
vi.mock("@/lib/alertas", () => ({
  alertar: async (nivel: string, titulo: string) => {
    alertas.enviadas.push({ nivel, titulo });
    return true;
  },
}));

import { MOTIVO_BAJA } from "@/app/api/_lib/casos-uso/despachar-sms";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { firmaTwilio, URL_CALLBACK, URL_ENTRANTE } from "@/lib/sms/firma";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
type Handler = (request: Request) => Promise<Response>;
let callback!: Handler;
let entrante!: Handler;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");
const TOKEN = "token-de-prueba";
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TELEFONO = "+59899123456";

function pedido(url: string, params: Record<string, string>, firma?: string | null) {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const f = firma === undefined ? firmaTwilio(TOKEN, url, params) : firma;
  if (f !== null) headers["x-twilio-signature"] = f;
  return new Request(url, { method: "POST", headers, body });
}

async function crearEnvio(estado: "aceptado" | "entregado" | "pendiente" | "enviando", sid: string | null) {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "L", apellido: "G", telefono: TELEFONO, tarifa: 1, organizationId: org.id },
  });
  return prismaRaw.envioSms.create({
    data: {
      organizationId: org.id, claveIdempotencia: `k:${randomUUID()}`, motivo: "recordatorio_turno", estado, sid,
      pacienteId: paciente.id, destino: TELEFONO, programadoEn: AHORA, proximoIntentoEn: estado === "pendiente" ? AHORA : null,
      aceptadoEn: sid ? AHORA : null,
    },
  });
}

const leer = (id: string) => prismaRaw.envioSms.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  ({ POST: callback } = await import("@/app/api/sms/callback/route"));
  ({ POST: entrante } = await import("@/app/api/sms/entrante/route"));
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  alertas.enviadas = [];
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("POST /api/sms/callback", () => {
  it("firma inválida → 403 y no se escribe nada", async () => {
    const envio = await crearEnvio("aceptado", "SM1");
    for (const firma of [null, "", "no-es-la-firma", firmaTwilio("otro-token", URL_CALLBACK, { MessageSid: "SM1", MessageStatus: "delivered" })]) {
      const r = await callback(pedido(URL_CALLBACK, { MessageSid: "SM1", MessageStatus: "delivered" }, firma));
      expect(r.status).toBe(403);
    }
    expect((await leer(envio.id)).estado).toBe("aceptado");
  });

  it("delivered con firma válida → entregado", async () => {
    const envio = await crearEnvio("aceptado", "SM1");
    const r = await callback(pedido(URL_CALLBACK, { MessageSid: "SM1", MessageStatus: "delivered", To: TELEFONO, AccountSid: "AC1" }));
    expect(r.status).toBe(204);
    const fila = await leer(envio.id);
    expect(fila.estado).toBe("entregado");
    expect(fila.cerradoEn).not.toBeNull();
  });

  it("undelivered con ErrorCode → no_entregado con el código y el motivo", async () => {
    const envio = await crearEnvio("aceptado", "SM2");
    const r = await callback(pedido(URL_CALLBACK, { MessageSid: "SM2", MessageStatus: "undelivered", ErrorCode: "30003" }));
    expect(r.status).toBe(204);
    expect(await leer(envio.id)).toMatchObject({ estado: "no_entregado", codigoProveedor: "30003", motivoNoEnvio: "el teléfono estaba apagado o sin señal" });
    expect(alertas.enviadas).toEqual([]);
  });

  it("30007 (filtrado por el operador) además avisa", async () => {
    await crearEnvio("aceptado", "SM3");
    await callback(pedido(URL_CALLBACK, { MessageSid: "SM3", MessageStatus: "failed", ErrorCode: "30007" }));
    expect(alertas.enviadas).toEqual([{ nivel: "aviso", titulo: "El operador está filtrando los SMS" }]);
  });

  it("un callback tardío no reabre un envío terminal", async () => {
    const envio = await crearEnvio("entregado", "SM4");
    await callback(pedido(URL_CALLBACK, { MessageSid: "SM4", MessageStatus: "undelivered", ErrorCode: "30005" }));
    expect((await leer(envio.id)).estado).toBe("entregado");
  });

  it("sent / queued no cambian nada; un sid desconocido tampoco", async () => {
    const envio = await crearEnvio("aceptado", "SM5");
    expect((await callback(pedido(URL_CALLBACK, { MessageSid: "SM5", MessageStatus: "sent" }))).status).toBe(204);
    expect((await callback(pedido(URL_CALLBACK, { MessageSid: "SMxx", MessageStatus: "delivered" }))).status).toBe(204);
    expect((await leer(envio.id)).estado).toBe("aceptado");
  });
});

describe("POST /api/sms/entrante", () => {
  it("firma inválida → 403 y ninguna baja", async () => {
    const r = await entrante(pedido(URL_ENTRANTE, { From: TELEFONO, Body: "BAJA" }, "mala"));
    expect(r.status).toBe(403);
    expect(await prismaRaw.bajaSms.count()).toBe(0);
  });

  it("BAJA (y variantes con tildes, espacios, mayúsculas) → baja, apaga lo pendiente y contesta TwiML", async () => {
    const pendiente = await crearEnvio("pendiente", null);
    const enviando = await crearEnvio("enviando", null);
    const aceptado = await crearEnvio("aceptado", "SM7");

    const r = await entrante(pedido(URL_ENTRANTE, { From: TELEFONO, To: "+59890000000", Body: "  Baja.  " }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/xml");
    expect(await r.text()).toContain("<Message>");

    expect(await prismaRaw.bajaSms.findUnique({ where: { telefono: TELEFONO } })).toMatchObject({ motivo: "respuesta_baja" });
    expect(await leer(pendiente.id)).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_BAJA });
    expect(await leer(enviando.id)).toMatchObject({ estado: "cancelado" });
    expect((await leer(aceptado.id)).estado).toBe("aceptado");

    for (const body of ["STOP", "cancelar", "Cancelár"]) {
      expect((await entrante(pedido(URL_ENTRANTE, { From: "+59891111111", Body: body }))).status).toBe(200);
    }
    expect(await prismaRaw.bajaSms.count()).toBe(2);
  });

  it("cualquier otro texto → 204 y no se guarda nada", async () => {
    const r = await entrante(pedido(URL_ENTRANTE, { From: TELEFONO, Body: "Hola, ¿puedo cambiar el turno?" }));
    expect(r.status).toBe(204);
    expect(await prismaRaw.bajaSms.count()).toBe(0);
  });

  it("repetir BAJA es idempotente", async () => {
    await entrante(pedido(URL_ENTRANTE, { From: TELEFONO, Body: "baja" }));
    await entrante(pedido(URL_ENTRANTE, { From: TELEFONO, Body: "baja" }));
    expect(await prismaRaw.bajaSms.count()).toBe(1);
  });
});

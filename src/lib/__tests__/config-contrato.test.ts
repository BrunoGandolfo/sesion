/**
 * Integración — el contrato de PATCH /api/config, contra la DB real de test.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/config-contrato.test.ts
 *
 * QUÉ PROTEGE
 *
 * `horasAnticipacion` era el número de horas de antelación del recordatorio.
 * Dejó de decidir nada cuando el aviso pasó a guardarse como un MOMENTO
 * (`recordatorioModo`), pero seguía en el schema del PATCH "por
 * compatibilidad": la ruta lo aceptaba y lo escribía, así que quien lo
 * mandara recibía un 200 y se iba convencido de haber cambiado cuándo le
 * llega el SMS a la paciente. Un contrato que contesta que sí a algo que no
 * hace es peor que uno que no lo acepta.
 *
 * La columna sigue existiendo (sacarla es una migración). Lo que se prueba es
 * que el PATCH la ignore, y que ignorarla no le impida guardar el resto del
 * cuerpo.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __resetKeyCacheForTests } from "@/lib/encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getServerSession: async () => {
    if (!sesionActual.organizationId) return null;
    return {
      organizationId: sesionActual.organizationId,
      userId: sesionActual.userId,
      user: {
        id: sesionActual.userId,
        organizationId: sesionActual.organizationId,
      },
    };
  },
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let patchConfig!: (request: Request) => Promise<Response>;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

/** El valor que tiene la columna antes de cada test. */
const HORAS_INICIALES = 24;

async function crearOrgConConfig(): Promise<string> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const user = await prismaRaw.user.create({
    data: {
      email: `${randomUUID()}@test.uy`,
      hashedPassword: "no-importa",
      nombre: "Mariana",
      organizationId: org.id,
    },
  });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      tarifaDefault: 1000,
      horasAnticipacion: HORAS_INICIALES,
      nombreProfesional: "Mariana Roldán",
      direccion: "Rivera 2540",
      whatsappOrigen: "+598 99 876 543",
      recordatorioModo: "dia_anterior",
    },
  });
  sesionActual.organizationId = org.id;
  sesionActual.userId = user.id;
  return org.id;
}

function pedidoPatch(body: unknown): Request {
  return new Request("http://localhost/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function leerConfig(organizationId: string) {
  return prismaRaw.configuracion.findUniqueOrThrow({
    where: { organizationId },
  });
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  const ruta = await import("@/app/api/config/route");
  patchConfig = ruta.PATCH as (request: Request) => Promise<Response>;
});

beforeEach(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
  sesionActual.userId = "";
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.NOTES_ENCRYPTION_KEY;
  } else {
    process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  __resetKeyCacheForTests();
});

describe("PATCH /api/config y horasAnticipacion", () => {
  it("mandarla no rompe, pero no la escribe", async () => {
    const orgId = await crearOrgConConfig();

    const res = await patchConfig(pedidoPatch({ horasAnticipacion: 72 }));

    expect(res.status).toBe(200);
    expect((await leerConfig(orgId)).horasAnticipacion).toBe(HORAS_INICIALES);
  });

  it("mezclada con campos reales, los reales se guardan igual", async () => {
    // El caso de un cliente viejo que manda el objeto entero: que se
    // descarte una clave no puede tirar abajo el resto del cuerpo.
    const orgId = await crearOrgConConfig();

    const res = await patchConfig(
      pedidoPatch({
        horasAnticipacion: 72,
        nombreProfesional: "Mariana R.",
        recordatorioModo: "misma_manana",
      }),
    );

    expect(res.status).toBe(200);
    const fila = await leerConfig(orgId);
    expect(fila.nombreProfesional).toBe("Mariana R.");
    expect(fila.recordatorioModo).toBe("misma_manana");
    expect(fila.horasAnticipacion).toBe(HORAS_INICIALES);
  });

  it("lo que sí decide cuándo sale el aviso es recordatorioModo", async () => {
    const orgId = await crearOrgConConfig();

    const res = await patchConfig(
      pedidoPatch({ recordatorioModo: "dos_dias_antes" }),
    );

    expect(res.status).toBe(200);
    expect((await leerConfig(orgId)).recordatorioModo).toBe("dos_dias_antes");
  });

  it("un modo que no existe se rechaza", async () => {
    const orgId = await crearOrgConConfig();

    const res = await patchConfig(pedidoPatch({ recordatorioModo: "el_lunes" }));

    expect(res.status).toBe(400);
    expect((await leerConfig(orgId)).recordatorioModo).toBe("dia_anterior");
  });
});

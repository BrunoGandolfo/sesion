/**
 * Integración — GET /api/turnos/cobros con el mes por query.
 *
 * La pantalla de Cobros la llama sin parámetros y tiene que seguir viendo el
 * mes actual; Finanzas la va a llamar con `?mes=` al tocar la barra de un mes.
 * El borde importa: un cobro del 30 a las 23:30 de Montevideo es de ese mes,
 * aunque en UTC ya sea el día 1 del siguiente.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/cobros-mes.test.ts
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { instanteMvd } from "@/lib/fechas-montevideo";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "" }));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: "u",
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let leerCobros!: (request: Request) => Promise<Response>;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;

interface Org {
  orgId: string;
  pacienteId: string;
}

async function crearOrg(): Promise<Org> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Ana",
      apellido: "López",
      telefono: `+5989900${Math.floor(1000 + Math.random() * 8999)}`,
      tarifa: 1200,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, pacienteId: paciente.id };
}

async function crearCobro(org: Org, pagoFecha: Date, tarifa: number) {
  await prismaRaw.turno.create({
    data: {
      fecha: pagoFecha,
      estado: "realizado",
      tarifaCobrada: tarifa,
      pagoEstado: "pagado",
      pagoFecha,
      pagoMetodo: "efectivo",
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
    },
  });
}

const cobros = (query = "") =>
  leerCobros(new Request(`http://localhost/api/turnos/cobros${query}`));

const tarifas = async (res: Response): Promise<number[]> =>
  ((await res.json()).data as { tarifaCobrada: number }[]).map(
    (t) => t.tarifaCobrada,
  );

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  leerCobros = (await import("@/app/api/turnos/cobros/route"))
    .GET as typeof leerCobros;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("cobros — el mes por query", () => {
  it("sin el parámetro contesta el mes actual, como siempre", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearCobro(org, new Date(), 1500);
    await crearCobro(org, instanteMvd(2020, 0, 15, 12), 999);

    expect(await tarifas(await cobros())).toEqual([1500]);
  });

  it("con ?mes= contesta ese mes, y el 30 a las 23:30 de Montevideo es de ese mes", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    // 23:30 del 30/9 en Montevideo es 02:30 UTC del 1/10.
    const borde = instanteMvd(2026, 8, 30, 23, 30);
    expect(borde.toISOString()).toBe("2026-10-01T02:30:00.000Z");
    await crearCobro(org, borde, 2500);
    await crearCobro(org, instanteMvd(2026, 9, 1, 0, 30), 700);

    expect(await tarifas(await cobros("?mes=2026-09"))).toEqual([2500]);
    expect(await tarifas(await cobros("?mes=2026-10"))).toEqual([700]);
  });

  it("acepta un día y toma su mes", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearCobro(org, instanteMvd(2026, 8, 3, 12), 1800);

    expect(await tarifas(await cobros("?mes=2026-09-28"))).toEqual([1800]);
  });

  it("un mes inválido da 400 y no una lista vacía", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    for (const query of ["?mes=2026-13", "?mes=ayer", "?mes=2026-02-31"]) {
      expect((await cobros(query)).status, query).toBe(400);
    }
  });

  it("no deja ver los cobros de otra organización", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    await crearCobro(a, instanteMvd(2026, 8, 3, 12), 4444);

    sesionActual.organizationId = b.orgId;
    expect(await tarifas(await cobros("?mes=2026-09"))).toEqual([]);

    sesionActual.organizationId = a.orgId;
    expect(await tarifas(await cobros("?mes=2026-09"))).toEqual([4444]);
  });
});

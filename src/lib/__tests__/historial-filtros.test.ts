/**
 * Integración — los filtros nuevos del historial clínico de una paciente.
 *
 * La ruta ya existía y la ficha de hoy la llama sin parámetros. Lo que este
 * archivo protege, antes que nada, es que SIN parámetros nuevos la respuesta
 * sea exactamente la de antes; después, que con ellos haga lo que promete,
 * incluido el borde del mes en hora de Montevideo.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/historial-filtros.test.ts
 */
import { randomUUID } from "node:crypto";

import type { EstadoSesion, PrismaClient } from "@prisma/client";
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
  getSessionActor: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return {
      organizationId: sesionActual.organizationId,
      userId: "u",
      sesionId: "s",
      rol: "titular",
      nombre: "Mariana",
      email: "mariana@test.uy",
    };
  },
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let leerHistorial!: (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

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

async function crearSesion(org: Org, fecha: Date, estado: EstadoSesion) {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha,
      estado: "realizado",
      tarifaCobrada: 1200,
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
    },
  });
  const sesion = await db.sesionClinica.create({
    data: { turnoId: turno.id, organizationId: org.orgId, estado },
    select: { id: true },
  });
  return { sesionId: sesion.id, turnoId: turno.id };
}

/** El historial de una paciente. `pacienteId` sale de la organización de la
 *  sesión salvo que se pase otro a propósito (el caso de aislamiento). */
const historial = (pacienteId: string, query = "") =>
  leerHistorial(
    new Request(`http://localhost/api/pacientes/x/documentacion${query}`),
    { params: Promise.resolve({ id: pacienteId }) },
  );

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  leerHistorial = (await import("@/app/api/pacientes/[id]/documentacion/route"))
    .GET as typeof leerHistorial;
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

// ────────────────────────────────────────────────────────────────────────────

describe("historial clínico — sin parámetros nuevos, lo mismo que antes", () => {
  it("devuelve revision y aprobada, página 1 de a diez, sin las fallidas", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 5, 10, 15), "aprobada");
    await crearSesion(org, instanteMvd(2026, 6, 10, 15), "revision");
    await crearSesion(org, instanteMvd(2026, 7, 10, 15), "fallida");
    await crearSesion(org, instanteMvd(2026, 7, 11, 15), "procesando");

    const { data } = await (await historial(org.pacienteId)).json();

    expect(data.totalSesiones).toBe(2);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBe(1);
    expect(data.sesiones.map((s: { estado: string }) => s.estado)).toEqual([
      "revision",
      "aprobada",
    ]);
  });

  it("la respuesta con `?page=1&limit=10` explícitos es idéntica a la de sin parámetros", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 5, 10, 15), "aprobada");

    const sin = await (await historial(org.pacienteId)).json();
    const con = await (await historial(org.pacienteId, "?page=1&limit=10")).json();
    expect(con).toEqual(sin);
  });
});

describe("historial clínico — desde y hasta", () => {
  it("por mes: toma el mes entero, y el 30 a las 23:30 de Montevideo entra", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    // 23:30 del 30/9 en Montevideo es 02:30 UTC del 1/10.
    const borde = instanteMvd(2026, 8, 30, 23, 30);
    expect(borde.toISOString()).toBe("2026-10-01T02:30:00.000Z");
    await crearSesion(org, borde, "aprobada");
    await crearSesion(org, instanteMvd(2026, 9, 1, 10), "aprobada");

    const septiembre = await (await historial(org.pacienteId, "?desde=2026-09&hasta=2026-09")).json();
    expect(septiembre.data.totalSesiones).toBe(1);
    expect(septiembre.data.sesiones[0].fecha).toBe(borde.toISOString());

    const octubre = await (await historial(org.pacienteId, "?desde=2026-10&hasta=2026-10")).json();
    expect(octubre.data.totalSesiones).toBe(1);
    expect(octubre.data.sesiones[0].fecha).toBe(
      instanteMvd(2026, 9, 1, 10).toISOString(),
    );
  });

  it("por día: toma el día entero de Montevideo, de 00:00 a 23:59:59.999", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 8, 30, 0, 0), "aprobada");
    await crearSesion(org, instanteMvd(2026, 8, 30, 23, 59, 59), "aprobada");
    await crearSesion(org, instanteMvd(2026, 8, 29, 23, 59, 59), "aprobada");

    const { data } = await (
      await historial(org.pacienteId, "?desde=2026-09-30&hasta=2026-09-30")
    ).json();
    expect(data.totalSesiones).toBe(2);
  });

  it("sólo `desde` deja abierto el final, y sólo `hasta` el principio", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 0, 10, 15), "aprobada");
    await crearSesion(org, instanteMvd(2026, 5, 10, 15), "aprobada");
    await crearSesion(org, instanteMvd(2026, 10, 10, 15), "aprobada");

    expect((await (await historial(org.pacienteId, "?desde=2026-06")).json()).data.totalSesiones).toBe(2);
    expect((await (await historial(org.pacienteId, "?hasta=2026-06")).json()).data.totalSesiones).toBe(2);
  });

  it("cruza el año sin perder nada", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2025, 11, 31, 23, 30), "aprobada");
    await crearSesion(org, instanteMvd(2026, 0, 2, 10), "aprobada");

    const { data } = await (
      await historial(org.pacienteId, "?desde=2025-12&hasta=2026-01")
    ).json();
    expect(data.totalSesiones).toBe(2);
    expect((await (await historial(org.pacienteId, "?desde=2025-12&hasta=2025-12")).json()).data.totalSesiones).toBe(1);
  });

  it("un mes o un día inválidos dan 400 y no una lista vacía", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    for (const query of ["?desde=2026-13", "?desde=ayer", "?hasta=2026-02-31", "?desde=2026-9"]) {
      expect((await historial(org.pacienteId, query)).status, query).toBe(400);
    }
  });
});

describe("historial clínico — incluirFallidas", () => {
  it("con incluirFallidas=1 entran las fallidas; con 0 o sin el parámetro, no", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 8, 10, 15), "aprobada");
    await crearSesion(org, instanteMvd(2026, 8, 11, 15), "fallida");

    expect((await (await historial(org.pacienteId)).json()).data.totalSesiones).toBe(1);
    expect((await (await historial(org.pacienteId, "?incluirFallidas=0")).json()).data.totalSesiones).toBe(1);

    const { data } = await (await historial(org.pacienteId, "?incluirFallidas=1")).json();
    expect(data.totalSesiones).toBe(2);
    expect(data.sesiones.map((s: { estado: string }) => s.estado)).toEqual([
      "fallida",
      "aprobada",
    ]);
  });

  it("los filtros quedan en el rastro de la exportación", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 8, 10, 15), "aprobada");

    await historial(org.pacienteId, "?desde=2026-09&hasta=2026-09&incluirFallidas=1");

    const [evento] = await prismaRaw.eventoAuditoria.findMany({
      where: { organizationId: org.orgId, accion: "sesion.exportar" },
    });
    expect(evento.detalle).toMatchObject({
      desde: "2026-09",
      hasta: "2026-09",
      incluirFallidas: true,
    });
  });

  it("los filtros no dejan ver la documentación de otra organización", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    await crearSesion(a, instanteMvd(2026, 8, 10, 15), "aprobada");

    sesionActual.organizationId = b.orgId;
    const res = await leerHistorial(
      new Request("http://localhost/api/pacientes/x/documentacion?desde=2026-01&incluirFallidas=1"),
      { params: Promise.resolve({ id: a.pacienteId }) },
    );
    expect(res.status).toBe(404);
  });
});

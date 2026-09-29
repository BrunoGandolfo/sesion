/**
 * Integración — el historial clínico de una paciente
 * (GET /api/pacientes/[id]/documentacion), como lo llama la ficha: página y
 * tamaño, nada más.
 *
 * Tuvo filtros `desde`, `hasta` e `incluirFallidas` que ninguna pantalla
 * mandaba; se sacaron por decisión del dueño (D4, 29-09-2026). Este archivo
 * se llamaba historial-filtros.test.ts: los casos de los filtros se fueron
 * con ellos y quedan los que valen igual —la respuesta por defecto, el
 * aislamiento entre organizaciones— y uno que prueba que esos parámetros ya
 * no cambian nada.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/historial-documentacion.test.ts
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

describe("historial clínico", () => {
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

  it("ignora desde, hasta e incluirFallidas: misma respuesta, y no entran al rastro", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    await crearSesion(org, instanteMvd(2026, 7, 10, 15), "aprobada");
    await crearSesion(org, instanteMvd(2026, 8, 30, 23, 30), "aprobada");
    await crearSesion(org, instanteMvd(2026, 8, 11, 15), "fallida");

    const sin = await (await historial(org.pacienteId)).json();
    // Antes cualquiera de estos filtraba (o daba 400 si era inválido).
    for (const query of [
      "?desde=2026-09&hasta=2026-09",
      "?desde=2026-10",
      "?hasta=2026-01",
      "?incluirFallidas=1",
      "?desde=2026-13&hasta=ayer",
    ]) {
      const res = await historial(org.pacienteId, query);
      expect(res.status, query).toBe(200);
      expect(await res.json(), query).toEqual(sin);
    }
    expect(sin.data.totalSesiones).toBe(2);

    const eventos = await prismaRaw.eventoAuditoria.findMany({
      where: { organizationId: org.orgId, accion: "sesion.exportar" },
    });
    expect(eventos.length).toBeGreaterThan(0);
    for (const evento of eventos) {
      expect(Object.keys(evento.detalle as object).sort()).toEqual(["limit", "page", "total"]);
    }
  });

  it("no deja ver la documentación de otra organización", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    await crearSesion(a, instanteMvd(2026, 8, 10, 15), "aprobada");

    sesionActual.organizationId = b.orgId;
    const res = await historial(a.pacienteId);
    expect(res.status).toBe(404);
  });
});

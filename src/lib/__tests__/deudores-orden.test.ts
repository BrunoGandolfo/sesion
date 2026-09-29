/**
 * /api/deudores y Hoy ordenan a las deudoras igual: un solo orden, el de Hoy
 * (monto descendente y, a igual monto, el impago más viejo primero;
 * lib/orden-deuda.ts). Decisión del dueño.
 *
 * Antes /api/deudores ponía primero a quien más días de atraso tenía, y Hoy
 * a quien más debía: con los datos de abajo, Carla (poca plata, deuda muy
 * vieja) salía primera en una pantalla y última en la otra. El test pide las
 * dos RUTAS sobre la misma base.
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { instanteMvd } from "@/lib/fechas-montevideo";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "" }));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => sesionActual.organizationId,
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: "u",
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

type Ruta = (request: Request) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let deudores!: Ruta;
let dashboard!: Ruta;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const HOY = instanteMvd(2026, 8, 30, 12);
const haceDias = (n: number) => new Date(HOY.getTime() - n * 86_400_000);

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  deudores = (await import("@/app/api/deudores/route")).GET as unknown as Ruta;
  dashboard = (await import("@/app/api/dashboard/route")).GET as unknown as Ruta;
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HOY);
});

afterEach(() => vi.useRealTimers());

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

it("/api/deudores y Hoy dan las mismas deudoras en el mismo orden: monto y, a igual monto, la más vieja", async () => {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  sesionActual.organizationId = org.id;

  // nombre → impagos (días atrás, tarifa)
  const plan: Record<string, Array<[number, number]>> = {
    Ana: [[2, 3000], [5, 3000]], // 6000, reciente
    Beto: [[20, 2000]], // 2000, a igual monto que Dora pero más vieja
    Carla: [[90, 500]], // 500, la de más días de atraso
    Dora: [[3, 1000], [4, 1000]], // 2000, más nueva que Beto
  };
  for (const [nombre, impagos] of Object.entries(plan)) {
    const paciente = await prismaRaw.paciente.create({
      data: { nombre, apellido: "Test", telefono: "+59899000000", tarifa: 1000, organizationId: org.id },
    });
    for (const [dias, tarifa] of impagos) {
      await prismaRaw.turno.create({
        data: { fecha: haceDias(dias), estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: tarifa, pacienteId: paciente.id, organizationId: org.id },
      });
    }
  }

  const deCobros = ((await (await deudores(new Request("http://localhost/api/deudores"))).json()).data as { nombre: string; diasAtraso: number }[]);
  const deHoy = ((await (await dashboard(new Request("http://localhost/api/dashboard"))).json()).data.deudores as { nombre: string }[]);

  expect(deCobros.map((d) => d.nombre)).toEqual(["Ana", "Beto", "Dora", "Carla"]);
  expect(deHoy.map((d) => d.nombre)).toEqual(deCobros.map((d) => d.nombre));
  // Los días de atraso siguen viajando; sólo dejaron de mandar en el orden.
  expect(deCobros.find((d) => d.nombre === "Carla")?.diasAtraso).toBe(90);
});

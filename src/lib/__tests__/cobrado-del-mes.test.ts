/**
 * "Cobrado en el mes" dice lo mismo en las tres pantallas que lo muestran.
 *
 * Hoy (KPI `ingresosMes` de GET /api/dashboard), Cobros del mes (GET
 * /api/turnos/cobros) y Finanzas (GET /api/finanzas/resumen) lo calculaban
 * por tres caminos: dos `where` de Prisma escritos por separado y un SQL con
 * el corrimiento a Montevideo. Ahora los dos primeros usan `cobradoEnMes` y
 * Finanzas la misma condición (`COBRADO`, domain.ts). Este test los pide a
 * las RUTAS sobre la misma base, con cobros justo en los bordes del mes en
 * hora de Montevideo, y exige el mismo número.
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
let dashboard!: Ruta;
let cobros!: Ruta;
let finanzas!: Ruta;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;

/** Mediados de septiembre de 2026 en Montevideo: el "hoy" de Hoy. */
const HOY = instanteMvd(2026, 8, 15, 12);

async function crearOrg() {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Ana", apellido: "López", telefono: "+59899001234", tarifa: 1000, organizationId: org.id },
  });
  return { orgId: org.id, pacienteId: paciente.id };
}

async function turno(
  org: { orgId: string; pacienteId: string },
  { fecha, pagoFecha, tarifa, pagado = true }: { fecha: Date; pagoFecha: Date | null; tarifa: number; pagado?: boolean },
) {
  await prismaRaw.turno.create({
    data: {
      fecha,
      estado: "realizado",
      tarifaCobrada: tarifa,
      pagoEstado: pagado ? "pagado" : "pendiente",
      pagoFecha,
      pagoMetodo: pagado ? "efectivo" : null,
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
    },
  });
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  dashboard = (await import("@/app/api/dashboard/route")).GET as unknown as Ruta;
  cobros = (await import("@/app/api/turnos/cobros/route")).GET as Ruta;
  finanzas = (await import("@/app/api/finanzas/resumen/route")).GET as Ruta;
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
  // Las rutas usan `new Date()`: se congela sólo Date, Prisma sigue con sus
  // timers reales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HOY);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

async function tresNumeros() {
  const hoy = (await (await dashboard(new Request("http://localhost/api/dashboard"))).json()).data.kpis.ingresosMes as number;
  const lista = (await (await cobros(new Request("http://localhost/api/turnos/cobros?mes=2026-09"))).json()).data as {
    tarifaCobrada: number;
  }[];
  const resumen = (await (await finanzas(new Request("http://localhost/api/finanzas/resumen?desde=2026-09&hasta=2026-09"))).json())
    .data as { totales: { cobrado: number }; serie: { clave: string; cobrado: number }[] };
  return {
    hoy,
    cobrosDelMes: lista.reduce((total, t) => total + t.tarifaCobrada, 0),
    finanzas: resumen.totales.cobrado,
    finanzasSerie: resumen.serie.find((p) => p.clave === "2026-09")?.cobrado,
  };
}

it("Hoy, Cobros del mes y Finanzas dan el mismo cobrado, con cobros en los bordes del mes", async () => {
  const org = await crearOrg();
  sesionActual.organizationId = org.orgId;
  const agosto = instanteMvd(2026, 7, 20, 10);

  // Entran en septiembre (mes del PAGO, en hora de Montevideo):
  await turno(org, { fecha: agosto, pagoFecha: instanteMvd(2026, 8, 1, 0, 0), tarifa: 1000 }); // 1/9 00:00 justo
  await turno(org, { fecha: agosto, pagoFecha: instanteMvd(2026, 8, 10, 15), tarifa: 2000 }); // turno de agosto, cobrado en septiembre
  await turno(org, { fecha: HOY, pagoFecha: instanteMvd(2026, 8, 30, 23, 30), tarifa: 4000 }); // 30/9 23:30 = 1/10 02:30Z
  // No entran:
  await turno(org, { fecha: agosto, pagoFecha: instanteMvd(2026, 7, 31, 23, 59), tarifa: 100 }); // 31/8 23:59
  await turno(org, { fecha: HOY, pagoFecha: instanteMvd(2026, 9, 1, 0, 30), tarifa: 200 }); // 1/10 00:30
  await turno(org, { fecha: HOY, pagoFecha: null, tarifa: 400, pagado: false }); // sin cobrar
  // Otra organización cobrando en septiembre: no suma.
  const ajena = await crearOrg();
  await turno(ajena, { fecha: HOY, pagoFecha: instanteMvd(2026, 8, 12, 12), tarifa: 8000 });

  const numeros = await tresNumeros();
  expect(numeros).toEqual({ hoy: 7000, cobrosDelMes: 7000, finanzas: 7000, finanzasSerie: 7000 });
});

it("sin cobros en el mes, los tres dicen cero", async () => {
  const org = await crearOrg();
  sesionActual.organizationId = org.orgId;
  await turno(org, { fecha: HOY, pagoFecha: instanteMvd(2026, 9, 2, 12), tarifa: 500 });

  expect(await tresNumeros()).toEqual({ hoy: 0, cobrosDelMes: 0, finanzas: 0, finanzasSerie: 0 });
});

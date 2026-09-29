/**
 * Integración — rutas que ningún test recorría de punta a punta: volver a
 * grabar (el paso que repite una subida fallida), la carga masiva y la
 * lista del vocabulario, la lista de pacientes y una versión vieja del
 * Recorrido. Se prueba lo que contesta cada ruta y lo que queda en la base,
 * no cómo lo hace.
 *
 * La sesión se mockea (como en multi-tenant.test.ts) y R2 también: acá no
 * se prueba el almacenamiento. Las rutas se importan después de poner el
 * cliente de test en el cache global de src/lib/db.ts.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLlaveroForTests } from "@/lib/llavero";
import { cifrarConsentimiento, cifrarHiloVersion } from "@/lib/prisma-encryption";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

vi.mock("@/app/api/_lib/auth", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/auth")>()),
  getOrganizationId: async () => sesionActual.organizationId,
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: sesionActual.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

vi.mock("@/lib/r2", async (original) => {
  const real = await original<typeof import("@/lib/r2")>();
  const firma = async (key: string) => ({
    url: "https://bucket.cuenta.r2.cloudflarestorage.com/x", key, expiraEn: new Date("2026-12-01T15:00:00.000Z"), headers: {},
  });
  return {
    ...real,
    r2Configurado: () => true,
    almacenAudio: { existe: async () => ({ existe: false, bytes: null }), firmarSubida: firma },
  };
});

type Ruta = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
const CLAVE_ORIGINAL = process.env.CLAVES_CIFRADO;

async function ruta(path: string, metodo: string): Promise<Ruta> {
  const modulo = (await import(/* @vite-ignore */ `@/app/api/${path}/route`)) as Record<string, Ruta>;
  return modulo[metodo];
}

async function llamar(path: string, metodo: string, opciones: { url?: string; cuerpo?: unknown; params?: Record<string, string> } = {}) {
  const handler = await ruta(path, metodo);
  const res = await handler(
    new Request(`http://localhost/api/${opciones.url ?? path}`, {
      method: metodo,
      ...(opciones.cuerpo === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(opciones.cuerpo) }),
    }),
    { params: Promise.resolve(opciones.params ?? {}) },
  );
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? (JSON.parse(texto) as { data?: unknown; error?: string }) : {} };
}

async function consultorio() {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await prismaRaw.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: "x", nombre: "Mariana", organizationId: org.id },
  });
  sesionActual.organizationId = org.id;
  sesionActual.userId = user.id;
  return org.id;
}

async function paciente(organizationId: string, nombre: string, apellido: string, activo = true) {
  return prismaRaw.paciente.create({
    data: { organizationId, nombre, apellido, telefono: `+5989${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, tarifa: 1000, activo },
  });
}

async function sesionEn(organizationId: string, estado: "subiendo" | "procesando" | "grabando") {
  const p = await paciente(organizationId, "Ana", "Pérez");
  await db.consentimientoGrabacion.create({
    data: {
      ...cifrarConsentimiento(randomUUID(), { textoCompleto: "Autorización", firmaDigital: "data:image/png;base64,AAAA" }),
      pacienteId: p.id, organizationId, firmadoEn: new Date("2026-09-01T14:00:00.000Z"), textoVersion: "2.8",
    },
  });
  const turno = await prismaRaw.turno.create({
    data: { organizationId, pacienteId: p.id, fecha: new Date(), estado: "programado", tarifaCobrada: 1000 },
  });
  const id = randomUUID();
  await prismaRaw.sesionClinica.create({ data: { id, organizationId, turnoId: turno.id, estado } });
  return id;
}

beforeAll(() => {
  process.env.CLAVES_CIFRADO = `1=${randomBytes(32).toString("base64")}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (CLAVE_ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = CLAVE_ORIGINAL;
  __resetLlaveroForTests();
});

// ─── volver a grabar ────────────────────────────────────────────────────────

describe("POST /api/sesion-clinica/[id]/volver-a-grabar", () => {
  const VOLVER = "sesion-clinica/[id]/volver-a-grabar";

  it("una subida que quedó en 'subiendo' vuelve a 'grabando', queda auditada y puede pedir otra URL", async () => {
    const org = await consultorio();
    const id = await sesionEn(org, "subiendo");

    const res = await llamar(VOLVER, "POST", { url: `sesion-clinica/${id}/volver-a-grabar`, params: { id } });
    expect(res.status).toBe(200);
    expect((res.cuerpo.data as { estado: string }).estado).toBe("grabando");
    expect((await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id } })).estado).toBe("grabando");
    expect(await prismaRaw.eventoAuditoria.count({ where: { entidadId: id, accion: "sesion.volver_a_grabar" } })).toBe(1);

    // El paso siguiente del flujo: pedir otra URL de subida funciona.
    const url = await llamar("sesion-clinica/[id]/upload-url", "POST", {
      url: `sesion-clinica/${id}/upload-url`, params: { id }, cuerpo: { tamanoBytes: 2048, mime: "audio/webm" },
    });
    expect(url.status).toBe(200);
    expect((await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id } })).estado).toBe("subiendo");
  });

  it.each(["procesando", "grabando"] as const)("desde '%s' no vuelve: 409 y la sesión queda como estaba", async (estado) => {
    const org = await consultorio();
    const id = await sesionEn(org, estado);

    const res = await llamar(VOLVER, "POST", { url: `sesion-clinica/${id}/volver-a-grabar`, params: { id } });
    expect(res.status).toBe(409);
    expect((await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id } })).estado).toBe(estado);
    expect(await prismaRaw.eventoAuditoria.count({ where: { entidadId: id } })).toBe(0);
  });

  it("una sesión que no existe: 404", async () => {
    await consultorio();
    const id = randomUUID();
    expect((await llamar(VOLVER, "POST", { url: `sesion-clinica/${id}/volver-a-grabar`, params: { id } })).status).toBe(404);
  });
});

// ─── vocabulario ────────────────────────────────────────────────────────────

describe("GET y POST /api/hot-words", () => {
  it("la carga masiva crea los nuevos, saltea el repetido y la lista los devuelve legibles y en orden", async () => {
    const org = await consultorio();
    const primera = await llamar("hot-words", "POST", { cuerpo: { termino: "transferencia", scope: "profesional" } });
    expect(primera.status).toBe(201);

    const masiva = await llamar("hot-words", "POST", {
      cuerpo: { hotWords: ["gurí", "transferencia", "Lacan"].map((termino) => ({ termino, scope: "profesional" })) },
    });
    expect(masiva.status).toBe(201);
    expect(masiva.cuerpo.data).toEqual({ count: 2 });

    const lista = await llamar("hot-words", "GET", { url: "hot-words?scope=profesional" });
    expect(lista.status).toBe(200);
    expect((lista.cuerpo.data as { termino: string }[]).map((h) => h.termino)).toEqual(["gurí", "Lacan", "transferencia"]);
    expect(await prismaRaw.hotWord.count({ where: { organizationId: org } })).toBe(3);
  });

  it("el vocabulario de una paciente se lista aparte del propio", async () => {
    const org = await consultorio();
    const p = await paciente(org, "Ana", "Pérez");
    await llamar("hot-words", "POST", {
      cuerpo: { hotWords: [{ termino: "bo", scope: "paciente", pacienteId: p.id }, { termino: "ta", scope: "profesional" }] },
    });

    const dePaciente = await llamar("hot-words", "GET", { url: `hot-words?scope=paciente&pacienteId=${p.id}` });
    expect((dePaciente.cuerpo.data as { termino: string }[]).map((h) => h.termino)).toEqual(["bo"]);
    const propio = await llamar("hot-words", "GET", { url: "hot-words?scope=profesional" });
    expect((propio.cuerpo.data as { termino: string }[]).map((h) => h.termino)).toEqual(["ta"]);
  });

  it("una carga masiva con una paciente que no existe no crea nada: 404", async () => {
    const org = await consultorio();
    const res = await llamar("hot-words", "POST", {
      cuerpo: { hotWords: [{ termino: "ok", scope: "profesional" }, { termino: "no", scope: "paciente", pacienteId: randomUUID() }] },
    });
    expect(res.status).toBe(404);
    expect(await prismaRaw.hotWord.count({ where: { organizationId: org } })).toBe(0);
  });

  it("pedir el vocabulario de una paciente sin decir cuál: 400", async () => {
    await consultorio();
    expect((await llamar("hot-words", "GET", { url: "hot-words?scope=paciente" })).status).toBe(400);
  });
});

// ─── pacientes ──────────────────────────────────────────────────────────────

describe("GET /api/pacientes", () => {
  it("lista las activas por apellido y nombre, con su deuda, y busca sin distinguir mayúsculas", async () => {
    const org = await consultorio();
    const zeta = await paciente(org, "Ana", "Zubía");
    await paciente(org, "Bea", "Alonso");
    await paciente(org, "Ana", "Alonso");
    await paciente(org, "Carla", "Archivada", false);
    await prismaRaw.turno.create({
      data: { organizationId: org, pacienteId: zeta.id, fecha: new Date("2026-09-01T15:00:00.000Z"), estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 1500 },
    });

    const activas = await llamar("pacientes", "GET");
    expect(activas.status).toBe(200);
    const filas = activas.cuerpo.data as { nombre: string; apellido: string; deudaTotal: number; sesionesImpagas: number }[];
    expect(filas.map((f) => `${f.apellido}, ${f.nombre}`)).toEqual(["Alonso, Ana", "Alonso, Bea", "Zubía, Ana"]);
    expect(filas[2]).toMatchObject({ deudaTotal: 1500, sesionesImpagas: 1 });

    const busqueda = await llamar("pacientes", "GET", { url: "pacientes?q=alONso" });
    expect((busqueda.cuerpo.data as { nombre: string }[]).map((f) => f.nombre)).toEqual(["Ana", "Bea"]);

    const archivadas = await llamar("pacientes", "GET", { url: "pacientes?activo=false" });
    expect((archivadas.cuerpo.data as { apellido: string }[]).map((f) => f.apellido)).toEqual(["Archivada"]);
  });
});

// ─── una versión del Recorrido ─────────────────────────────────────────────

describe("GET /api/pacientes/[id]/hilo/versiones/[version]", () => {
  const VERSION = "pacientes/[id]/hilo/versiones/[version]";
  const contenido = {
    hipotesisDiagnostica: null,
    resumenAcumulativo: "Primera versión",
    objetivosTerapeuticos: [],
    intervencionesProbadas: [],
    temasRecurrentes: [],
    riesgosHistoricos: [],
    cambios: [],
  };

  it("devuelve la versión pedida con su contenido; una que no existe, 404; una que no es número, 400", async () => {
    const org = await consultorio();
    const p = await paciente(org, "Ana", "Pérez");
    await prismaRaw.hilo.create({ data: { pacienteId: p.id, organizationId: org, ultimaVersion: 1 } });
    await db.hiloVersion.create({
      data: { pacienteId: p.id, organizationId: org, version: 1, actor: "ia", estado: "propuesta", ...cifrarHiloVersion(randomUUID(), { contenido }) },
    });

    const una = await llamar(VERSION, "GET", { url: `pacientes/${p.id}/hilo/versiones/1`, params: { id: p.id, version: "1" } });
    expect(una.status).toBe(200);
    expect(una.cuerpo.data).toMatchObject({ version: 1, estado: "propuesta", contenido: { resumenAcumulativo: "Primera versión" } });

    expect((await llamar(VERSION, "GET", { url: `pacientes/${p.id}/hilo/versiones/2`, params: { id: p.id, version: "2" } })).status).toBe(404);
    expect((await llamar(VERSION, "GET", { url: `pacientes/${p.id}/hilo/versiones/x`, params: { id: p.id, version: "x" } })).status).toBe(400);
  });
});

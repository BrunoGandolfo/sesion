/**
 * Integración — GET /api/sesion-clinica/avisos y su caso de uso, contra la
 * base de test: qué sesiones cuentan como en proceso y cuáles como listas o
 * fallidas SIN VER por esta usuaria, sabido por los `sesion.ver` de
 * auditoría. Incluye el circuito entero con las rutas reales: abrir la nota
 * con GET /api/sesion-clinica/[id] la saca de los avisos.
 *
 * El aislamiento entre organizaciones de esta ruta está en
 * multi-tenant.test.ts, junto al barrido de las demás.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { EstadoSesion, PrismaClient } from "@prisma/client";

import {
  VENTANA_AVISOS_MS,
  VENTANA_EN_PROCESO_MS,
  avisosNotas,
} from "@/app/api/_lib/casos-uso/avisos-notas";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { cifrarSesion } from "@/lib/prisma-encryption";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const actor = vi.hoisted(() => ({ organizationId: "", userId: "" }));
vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => actor.organizationId,
  getSessionActor: async () => ({
    organizationId: actor.organizationId,
    userId: actor.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let rutaAvisos!: typeof import("@/app/api/sesion-clinica/avisos/route").GET;
let rutaSesion!: typeof import("@/app/api/sesion-clinica/[id]/route").GET;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const AHORA = new Date("2026-09-23T15:00:00.000Z");
const minutos = (n: number) => new Date(AHORA.getTime() - n * 60_000);

interface Consultorio {
  orgId: string;
  userId: string;
  colegaId: string;
  pacienteId: string;
}

async function crearConsultorio(): Promise<Consultorio> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const usuaria = (nombre: string) =>
    prismaRaw.user.create({
      data: {
        email: `${randomUUID()}@test.uy`,
        hashedPassword: "no-importa",
        nombre,
        organizationId: org.id,
      },
    });
  const [user, colega] = [await usuaria("Mariana"), await usuaria("Colega")];
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Lucía",
      apellido: "Fernández",
      telefono: `+5989${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, userId: user.id, colegaId: colega.id, pacienteId: paciente.id };
}

interface SesionDePrueba {
  estado: EstadoSesion;
  procesadaEn?: Date;
  /** Cuándo se movió la fila por última vez (se escribe a mano: @updatedAt). */
  actualizadaEn?: Date;
  fecha?: Date;
  conTexto?: boolean;
}

async function crearSesion(c: Consultorio, s: SesionDePrueba): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: s.fecha ?? minutos(90),
      estado: "realizado",
      tarifaCobrada: 1000,
      pacienteId: c.pacienteId,
      organizationId: c.orgId,
    },
  });
  const id = randomUUID();
  await db.sesionClinica.create({
    data: {
      id,
      organizationId: c.orgId,
      turnoId: turno.id,
      estado: s.estado,
      audioEstado: "en_r2",
      generacion: s.estado === "revision" ? 1 : 0,
      procesadaEn: s.procesadaEn ?? null,
      falloCodigo: s.estado === "fallida" ? "asr_timeout" : null,
      ...(s.conTexto
        ? cifrarSesion(id, {
            transcripcion: "La paciente cuenta que no duerme desde marzo.",
            notaIa: {
              subjetivo: "Insomnio desde marzo.",
              objetivo: "Ansiosa.",
              analisis: "Duelo.",
              plan: "Seguir.",
            },
          })
        : {}),
    },
  });
  await prismaRaw.$executeRaw`
    UPDATE sesiones_clinicas SET actualizada_en = ${s.actualizadaEn ?? minutos(1)} WHERE id = ${id}`;
  return id;
}

async function evento(
  c: Consultorio,
  accion: "sesion.ver" | "sesion.reintentar",
  sesionId: string,
  creadoEn: Date,
  { quien = c.userId, estado }: { quien?: string; estado?: EstadoSesion } = {},
) {
  await prismaRaw.eventoAuditoria.create({
    data: {
      organizationId: c.orgId,
      actorTipo: "usuario",
      actorId: quien,
      accion,
      entidad: "sesion_clinica",
      entidadId: sesionId,
      detalle: estado ? { estado } : {},
      creadoEn,
    },
  });
}

const avisosDe = (c: Consultorio, ahora = AHORA) =>
  avisosNotas({ prisma: db, organizationId: c.orgId, userId: c.userId, ahora });

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  // Las rutas ven el cliente de test por el cache global de src/lib/db.ts.
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  rutaAvisos = (await import("@/app/api/sesion-clinica/avisos/route")).GET;
  rutaSesion = (await import("@/app/api/sesion-clinica/[id]/route")).GET;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("qué está en proceso", () => {
  it("subiendo y procesando recientes, sí; una subida abandonada hace horas, no", async () => {
    const c = await crearConsultorio();
    const procesando = await crearSesion(c, { estado: "procesando", actualizadaEn: minutos(1) });
    const subiendo = await crearSesion(c, { estado: "subiendo", actualizadaEn: minutos(5) });
    await crearSesion(c, {
      estado: "subiendo",
      actualizadaEn: new Date(AHORA.getTime() - VENTANA_EN_PROCESO_MS - 60_000),
    });
    await crearSesion(c, { estado: "grabando" });
    await crearSesion(c, { estado: "aprobada", procesadaEn: minutos(30) });

    const avisos = await avisosDe(c);
    expect(avisos.map((a) => [a.id, a.estado]).sort()).toEqual(
      [[procesando, "procesando"], [subiendo, "subiendo"]].sort(),
    );
  });
});

describe("qué quedó sin ver", () => {
  it("una nota lista sin sesion.ver de ella es aviso, con nombre, estado y fecha del turno", async () => {
    const c = await crearConsultorio();
    const fecha = minutos(120);
    const id = await crearSesion(c, { estado: "revision", procesadaEn: minutos(3), fecha });
    expect(await avisosDe(c)).toEqual([
      { id, paciente: "Lucía Fernández", estado: "revision", fecha: fecha.toISOString() },
    ]);
  });

  it("vista después de quedar lista, no; vista solo antes (Volver a escribirla), sí", async () => {
    const c = await crearConsultorio();
    const vista = await crearSesion(c, { estado: "revision", procesadaEn: minutos(10) });
    await evento(c, "sesion.ver", vista, minutos(5), { estado: "revision" });
    const reescrita = await crearSesion(c, { estado: "revision", procesadaEn: minutos(4) });
    await evento(c, "sesion.ver", reescrita, minutos(20), { estado: "revision" });
    // Mirada mientras se procesaba (la pantalla de la sesión la consulta): no cuenta.
    const miradaAntes = await crearSesion(c, { estado: "revision", procesadaEn: minutos(4) });
    await evento(c, "sesion.ver", miradaAntes, minutos(6), { estado: "procesando" });

    const ids = (await avisosDe(c)).map((a) => a.id).sort();
    expect(ids).toEqual([reescrita, miradaAntes].sort());
  });

  it("que la haya abierto una colega no cuenta: el aviso es por usuaria", async () => {
    const c = await crearConsultorio();
    const id = await crearSesion(c, { estado: "revision", procesadaEn: minutos(10) });
    await evento(c, "sesion.ver", id, minutos(5), { quien: c.colegaId, estado: "revision" });
    expect((await avisosDe(c)).map((a) => a.id)).toEqual([id]);
    const colega = await avisosNotas({ prisma: db, organizationId: c.orgId, userId: c.colegaId, ahora: AHORA });
    expect(colega).toEqual([]);
  });

  it("fallida: sin ver es aviso; vista en fallida, no; vista y reintentada que volvió a fallar, sí", async () => {
    const c = await crearConsultorio();
    const sinVer = await crearSesion(c, { estado: "fallida", actualizadaEn: minutos(2) });
    const vista = await crearSesion(c, { estado: "fallida", actualizadaEn: minutos(20) });
    await evento(c, "sesion.ver", vista, minutos(15), { estado: "fallida" });
    // El borrado del audio mueve actualizada_en después de que ella la vio.
    await prismaRaw.$executeRaw`UPDATE sesiones_clinicas SET actualizada_en = ${minutos(1)} WHERE id = ${vista}`;
    const otraVez = await crearSesion(c, { estado: "fallida", actualizadaEn: minutos(2) });
    await evento(c, "sesion.ver", otraVez, minutos(40), { estado: "fallida" });
    await evento(c, "sesion.reintentar", otraVez, minutos(30));

    const avisos = await avisosDe(c);
    expect(avisos.map((a) => a.id).sort()).toEqual([sinVer, otraVez].sort());
    expect(avisos.every((a) => a.estado === "fallida")).toBe(true);
  });

  it("la ficha abierta mientras se escribe no la da por vista: la última consulta del sondeo no cuenta", async () => {
    const c = await crearConsultorio();
    // useSesionClinicaPolling cada 10 s, desde la pestaña Datos de la ficha.
    const s = (n: number) => new Date(AHORA.getTime() - 10 * 60_000 + n * 1000);
    // La nota llega entre la tercera y la cuarta consulta.
    const lista = await crearSesion(c, { estado: "revision", procesadaEn: s(25) });
    await evento(c, "sesion.ver", lista, s(0), { estado: "procesando" });
    await evento(c, "sesion.ver", lista, s(10.4), { estado: "procesando" });
    await evento(c, "sesion.ver", lista, s(20.9), { estado: "procesando" });
    await evento(c, "sesion.ver", lista, s(31.3), { estado: "revision" });
    const fallida = await crearSesion(c, { estado: "fallida", actualizadaEn: s(15) });
    await evento(c, "sesion.ver", fallida, s(0), { estado: "procesando" });
    // Una red lenta: 10 s de espera y 8 de pedido.
    await evento(c, "sesion.ver", fallida, s(18), { estado: "fallida" });
    expect((await avisosDe(c)).map((a) => a.id).sort()).toEqual([lista, fallida].sort());

    // Y cuando la abre de verdad, pasado un intervalo de sondeo, sí cuenta.
    await evento(c, "sesion.ver", lista, s(45), { estado: "revision" });
    expect((await avisosDe(c)).map((a) => a.id)).toEqual([fallida]);
  });

  it("con la ficha abierta en dos dispositivos, las dos colas de sondeo no cuentan", async () => {
    const c = await crearConsultorio();
    const s = (n: number) => new Date(AHORA.getTime() - 10 * 60_000 + n * 1000);
    const id = await crearSesion(c, { estado: "revision", procesadaEn: s(15) });
    await evento(c, "sesion.ver", id, s(10), { estado: "procesando" }); // teléfono
    await evento(c, "sesion.ver", id, s(13), { estado: "procesando" }); // computadora
    await evento(c, "sesion.ver", id, s(20.5), { estado: "revision" }); // teléfono
    await evento(c, "sesion.ver", id, s(23.4), { estado: "revision" }); // computadora
    expect((await avisosDe(c)).map((a) => a.id)).toEqual([id]);
  });

  it("salir de la ficha mientras se procesa y abrir la nota desde la franja al rato sí cuenta", async () => {
    const c = await crearConsultorio();
    const id = await crearSesion(c, { estado: "revision", procesadaEn: minutos(2) });
    // La última consulta de la ficha, en proceso, un minuto antes de abrirla.
    await evento(c, "sesion.ver", id, new Date(minutos(1).getTime() - 30_000), { estado: "procesando" });
    await evento(c, "sesion.ver", id, new Date(minutos(1).getTime() + 30_000), { estado: "revision" });
    expect(await avisosDe(c)).toEqual([]);
  });

  it("abrirla después de haberla mirado en proceso hace rato sí cuenta", async () => {
    const c = await crearConsultorio();
    const id = await crearSesion(c, { estado: "revision", procesadaEn: minutos(5) });
    await evento(c, "sesion.ver", id, minutos(8), { estado: "procesando" });
    await evento(c, "sesion.ver", id, minutos(1), { estado: "revision" });
    expect(await avisosDe(c)).toEqual([]);
  });

  it("una nota lista hace más de una semana ya no es aviso (sigue en Pendientes)", async () => {
    const c = await crearConsultorio();
    await crearSesion(c, {
      estado: "revision",
      procesadaEn: new Date(AHORA.getTime() - VENTANA_AVISOS_MS - 60_000),
    });
    expect(await avisosDe(c)).toEqual([]);
  });
});

describe("la ruta", () => {
  it("no trae texto clínico: solo id, paciente, estado y fecha", async () => {
    const c = await crearConsultorio();
    // La ruta usa el reloj de verdad.
    const recien = new Date(Date.now() - 3 * 60_000);
    await crearSesion(c, { estado: "revision", procesadaEn: recien, conTexto: true });
    await crearSesion(c, { estado: "procesando", actualizadaEn: new Date(), conTexto: true });
    actor.organizationId = c.orgId;
    actor.userId = c.userId;

    const res = await rutaAvisos();
    expect(res.status).toBe(200);
    const crudo = await res.text();
    const { data } = JSON.parse(crudo) as { data: Record<string, unknown>[] };
    expect(data).toHaveLength(2);
    for (const fila of data) expect(Object.keys(fila).sort()).toEqual(["estado", "fecha", "id", "paciente"]);
    for (const palabra of ["duerme", "marzo", "Insomnio", "Ansiosa", "Duelo", "transcripcion", "nota"]) {
      expect(crudo).not.toContain(palabra);
    }
  });

  it("abrir la nota con GET /api/sesion-clinica/[id] la saca de los avisos, y no vuelve", async () => {
    const c = await crearConsultorio();
    const id = await crearSesion(c, {
      estado: "revision",
      procesadaEn: new Date(Date.now() - 60_000),
      conTexto: true,
    });
    actor.organizationId = c.orgId;
    actor.userId = c.userId;
    const leerAvisos = async () =>
      ((await (await rutaAvisos()).json()) as { data: { id: string }[] }).data.map((a) => a.id);

    expect(await leerAvisos()).toEqual([id]);
    // Consultar los avisos no deja auditoría: no la da por vista.
    expect(await leerAvisos()).toEqual([id]);

    const abierta = await rutaSesion(new Request(`http://localhost/api/sesion-clinica/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(abierta.status).toBe(200);

    expect(await leerAvisos()).toEqual([]);
    expect(await leerAvisos()).toEqual([]);
  });
});

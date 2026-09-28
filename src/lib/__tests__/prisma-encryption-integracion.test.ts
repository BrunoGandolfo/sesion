/**
 * La extensión de cifrado contra la base de test (DATABASE_URL_TEST): lee y
 * escribe de verdad, la rotación del llavero y el mantenimiento (purgas y
 * re-cifrado). La parte pura está en prisma-encryption.test.ts.
 *
 * Está en la lista INTEGRACION de vitest.config.ts y, sin base, FALLA en
 * vez de saltearse: antes estos bloques llevaban `describe.skipIf(sin
 * base)`, y era el único archivo de integración que podía dar verde sin
 * haber corrido. Base: ver db-test.ts.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  mantenimiento,
  purgarOperativas,
  recifrarTanda,
  RESERVA_HUERFANA_MS,
  RETENCION_OPERATIVA_DIAS,
} from "@/app/api/_lib/casos-uso/mantenimiento";
import { ErrorDescifrado } from "@/lib/encryption";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  cifrarConsentimiento,
  cifrarHiloVersion,
  cifrarHotWord,
  cifrarPaciente,
  cifrarSesion,
  cifrarTurno,
  type ClienteCifrado,
} from "@/lib/prisma-encryption";

import { idClaveDe } from "./ayudantes";
import { CLAVES_CIFRADO_TEST, conectarBaseIdentidad, vaciarBaseIdentidad } from "./base-identidad";

const ORIGINAL = process.env.CLAVES_CIFRADO;

function llavero(texto: string) {
  process.env.CLAVES_CIFRADO = texto;
  __resetLlaveroForTests();
}

llavero(CLAVES_CIFRADO_TEST);
beforeAll(() => llavero(CLAVES_CIFRADO_TEST));
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  __resetLlaveroForTests();
});

describe("extensión contra la base de test", () => {
  let prisma!: PrismaClient;
  let db!: ClienteCifrado;

  beforeAll(() => {
    ({ prisma, db } = conectarBaseIdentidad());
  });
  beforeEach(() => vaciarBaseIdentidad(prisma));
  afterAll(() => prisma.$disconnect());

  async function organizacion() {
    return prisma.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  }

  async function paciente(organizationId: string, notas: string | null = null) {
    const id = randomUUID();
    return db.paciente.create({
      data: {
        nombre: "Test",
        apellido: "Paciente",
        telefono: "+59899000000",
        tarifa: 1000,
        organizationId,
        ...cifrarPaciente(id, { notas }),
      },
    });
  }

  it("escribe ENC2 con el id de la clave activa y lee el campo lógico", async () => {
    const org = await organizacion();
    const p = await paciente(org.id, "alergia al polen");

    const leido = await db.paciente.findUnique({ where: { id: p.id }, select: { id: true, notas: true } });
    expect(leido?.notas).toBe("alergia al polen");

    const [fila] = await prisma.$queryRaw<{ notas_encrypted: Buffer }[]>`
      SELECT notas_encrypted FROM pacientes WHERE id = ${p.id}`;
    expect(fila.notas_encrypted.subarray(0, 4).toString("ascii")).toBe("ENC2");
    expect(idClaveDe(fila.notas_encrypted)).toBe(1);
    expect(fila.notas_encrypted.toString("utf8")).not.toContain("polen");
  });

  it("un blob copiado a otra fila por SQL no se puede leer", async () => {
    const org = await organizacion();
    const a = await paciente(org.id, "secreto de A");
    const b = await paciente(org.id, null);

    await prisma.$executeRaw`
      UPDATE pacientes SET notas_encrypted = (SELECT notas_encrypted FROM pacientes WHERE id = ${a.id})
      WHERE id = ${b.id}`;

    await expect(
      db.paciente.findUnique({ where: { id: b.id }, select: { notas: true } }),
    ).rejects.toBeInstanceOf(ErrorDescifrado);
    expect((await db.paciente.findUnique({ where: { id: a.id }, select: { notas: true } }))?.notas).toBe("secreto de A");
  });

  it("un blob copiado a otra columna/tabla tampoco", async () => {
    const org = await organizacion();
    const a = await paciente(org.id, "nota de paciente");
    const t = await db.turno.create({
      data: { id: randomUUID(), fecha: new Date(), tarifaCobrada: 1000, pacienteId: a.id, organizationId: org.id },
    });
    await prisma.$executeRaw`
      UPDATE turnos SET notas_encrypted = (SELECT notas_encrypted FROM pacientes WHERE id = ${a.id})
      WHERE id = ${t.id}`;
    await expect(db.turno.findUnique({ where: { id: t.id }, select: { notas: true } })).rejects.toBeInstanceOf(
      ErrorDescifrado,
    );
  });

  it("la guarda rechaza create sin id y updateMany sin where.id antes de tocar la base", async () => {
    const org = await organizacion();
    const blob = cifrarPaciente("otra-fila", { notas: "x" });
    await expect(
      db.paciente.create({
        data: { nombre: "N", apellido: "A", telefono: "", tarifa: 1, organizationId: org.id, notasEncrypted: blob.notasEncrypted },
      }),
    ).rejects.toThrow(/exige data.id/);
    await expect(
      db.paciente.updateMany({ where: { organizationId: org.id }, data: { notasEncrypted: blob.notasEncrypted } }),
    ).rejects.toThrow(/exige where.id/);
    expect(await prisma.paciente.count()).toBe(0);
  });

  it("where sobre un campo cifrado se rechaza", async () => {
    await expect(db.paciente.findMany({ where: { notas: "x" } as never })).rejects.toThrow(/Cannot filter/);
    await expect(db.hotWord.findMany({ where: { terminoEncrypted: null } as never })).rejects.toThrow(/Cannot filter/);
  });

  it("update con cifrarX(id) sobre la misma fila reemplaza; null borra", async () => {
    const org = await organizacion();
    const p = await paciente(org.id, "v1");
    await db.paciente.updateMany({ where: { id: p.id, organizationId: org.id }, data: cifrarPaciente(p.id, { notas: "v2" }) });
    expect((await db.paciente.findUnique({ where: { id: p.id }, select: { notas: true } }))?.notas).toBe("v2");
    await db.paciente.update({ where: { id: p.id }, data: cifrarPaciente(p.id, { notas: null }) });
    expect((await db.paciente.findUnique({ where: { id: p.id }, select: { notas: true } }))?.notas).toBeNull();
  });

  it("sesión clínica: los seis campos lógicos van y vuelven", async () => {
    const org = await organizacion();
    const p = await paciente(org.id);
    const t = await prisma.turno.create({
      data: { id: randomUUID(), fecha: new Date(), tarifaCobrada: 1000, pacienteId: p.id, organizationId: org.id },
    });
    const id = randomUUID();
    await db.sesionClinica.create({
      data: {
        turnoId: t.id,
        organizationId: org.id,
        ...cifrarSesion(id, {
          transcripcion: "T: hola\nP: hola",
          notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" },
          datos: { riesgoDetectado: { nivel: "ninguno" } },
          feedback: { puntaje: 3 },
          notaFinal: null,
          notasEdicion: null,
        }),
      },
    });
    const s = await db.sesionClinica.findUniqueOrThrow({
      where: { id },
      select: { transcripcion: true, notaIa: true, datos: true, feedback: true, notaFinal: true, notasEdicion: true },
    });
    expect(s).toMatchObject({
      transcripcion: "T: hola\nP: hola",
      notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" },
      datos: { riesgoDetectado: { nivel: "ninguno" } },
      feedback: { puntaje: 3 },
      notaFinal: null,
      notasEdicion: null,
    });

    await db.sesionClinica.updateMany({
      where: { id, organizationId: org.id },
      data: { estado: "aprobada", ...cifrarSesion(id, { notaFinal: { subjetivo: "s2", objetivo: null, analisis: null, plan: null }, notasEdicion: "ok" }) },
    });
    const s2 = await db.sesionClinica.findUniqueOrThrow({ where: { id }, select: { notaFinal: true, notasEdicion: true } });
    expect(s2.notaFinal?.subjetivo).toBe("s2");
    expect(s2.notasEdicion).toBe("ok");
  });

  it("hot word, consentimiento y versión del hilo: campos obligatorios cifrados", async () => {
    const org = await organizacion();
    const p = await paciente(org.id);

    const hw = await db.hotWord.create({
      data: { organizationId: org.id, alcance: "global", terminoHash: "a".repeat(64), ...cifrarHotWord(randomUUID(), { termino: "Rorschach" }) },
    });
    expect((await db.hotWord.findUniqueOrThrow({ where: { id: hw.id }, select: { termino: true } })).termino).toBe("Rorschach");

    const c = await db.consentimientoGrabacion.create({
      data: {
        pacienteId: p.id, organizationId: org.id, firmadoEn: new Date(), textoVersion: "2.0",
        ...cifrarConsentimiento(randomUUID(), { textoCompleto: "Consentimiento…", firmaDigital: "data:image/png;base64,AAA" }),
      },
    });
    const cLeido = await db.consentimientoGrabacion.findUniqueOrThrow({ where: { id: c.id }, select: { textoCompleto: true, firmaDigital: true } });
    expect(cLeido).toMatchObject({ textoCompleto: "Consentimiento…", firmaDigital: "data:image/png;base64,AAA" });

    await prisma.hilo.create({ data: { pacienteId: p.id, organizationId: org.id } });
    const v = await db.hiloVersion.create({
      data: {
        pacienteId: p.id, organizationId: org.id, version: 1, actor: "profesional", estado: "aplicada",
        ...cifrarHiloVersion(randomUUID(), { contenido: { resumenAcumulativo: "r", cambios: [] } }),
      },
    });
    expect((await db.hiloVersion.findUniqueOrThrow({ where: { id: v.id }, select: { contenido: true } })).contenido).toEqual({
      resumenAcumulativo: "r",
      cambios: [],
    });
  });

  it("rotación: agregar la clave 2 cifra lo nuevo con 2 y sigue leyendo lo viejo; sin la 1, lo viejo grita", async () => {
    const org = await organizacion();
    const viejo = await paciente(org.id, "cifrado con 1");

    const K2 = randomBytes(32).toString("base64");
    llavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);
    const nuevo = await paciente(org.id, "cifrado con 2");

    const filas = await prisma.$queryRaw<{ id: string; notas_encrypted: Buffer }[]>`
      SELECT id, notas_encrypted FROM pacientes WHERE id IN (${viejo.id}, ${nuevo.id})`;
    const porId = new Map(filas.map((f) => [f.id, idClaveDe(f.notas_encrypted)]));
    expect(porId.get(viejo.id)).toBe(1);
    expect(porId.get(nuevo.id)).toBe(2);
    expect((await db.paciente.findUnique({ where: { id: viejo.id }, select: { notas: true } }))?.notas).toBe("cifrado con 1");

    llavero(`2=${K2}`);
    await expect(db.paciente.findUnique({ where: { id: viejo.id }, select: { notas: true } })).rejects.toMatchObject({
      codigo: "clave_ausente",
    });
    llavero(CLAVES_CIFRADO_TEST);
    // El blob que cifra con 2 ya no se lee sin la 2: un test que no restaure el llavero rompería al siguiente.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mantenimiento: purgas a 30 días y re-cifrado incremental.
// ─────────────────────────────────────────────────────────────────────────────

describe("mantenimiento contra la base de test", () => {
  let prisma!: PrismaClient;
  let db!: ClienteCifrado;
  const DIA = 24 * 60 * 60 * 1000;
  const AHORA = new Date("2026-09-11T04:00:00.000Z");

  beforeAll(() => {
    ({ prisma, db } = conectarBaseIdentidad());
  });
  beforeEach(async () => {
    llavero(CLAVES_CIFRADO_TEST);
    await vaciarBaseIdentidad(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it("purga lo operativo con más de 30 días y las reservas huérfanas; conserva lo vivo y lo clínico", async () => {
    const org = await prisma.organization.create({ data: { nombre: "Org" } });
    const user = await prisma.user.create({ data: { email: "m@test.uy", hashedPassword: "h", nombre: "M", organizationId: org.id } });
    const viejo = new Date(AHORA.getTime() - (RETENCION_OPERATIVA_DIAS + 1) * DIA);
    const reciente = new Date(AHORA.getTime() - 2 * DIA);
    const futuro = new Date(AHORA.getTime() + 10 * DIA);

    await prisma.intentoAcceso.createMany({
      data: [
        { tipo: "login", clave: "ip:1", creadoEn: viejo },
        { tipo: "login", clave: "ip:1", creadoEn: reciente },
      ],
    });
    await prisma.sesionAcceso.createMany({
      data: [
        { userId: user.id, tokenHash: "a".repeat(64), ultimoUsoEn: viejo, venceEn: futuro, cerradaEn: viejo, motivoCierre: "salida" },
        { userId: user.id, tokenHash: "b".repeat(64), ultimoUsoEn: viejo, venceEn: viejo },
        { userId: user.id, tokenHash: "c".repeat(64), ultimoUsoEn: reciente, venceEn: futuro },
        { userId: user.id, tokenHash: "d".repeat(64), ultimoUsoEn: reciente, venceEn: futuro, cerradaEn: reciente, motivoCierre: "salida" },
      ],
    });
    await prisma.passwordReset.createMany({
      data: [
        { userId: user.id, tokenHash: "e".repeat(64), venceEn: viejo, usadoEn: viejo, enviadoEn: viejo },
        { userId: user.id, tokenHash: "f".repeat(64), venceEn: futuro, enviadoEn: null, creadoEn: new Date(AHORA.getTime() - RESERVA_HUERFANA_MS - 1000) },
        { userId: user.id, tokenHash: "g".repeat(64), venceEn: futuro, enviadoEn: null, creadoEn: AHORA },
        { userId: user.id, tokenHash: "h".repeat(64), venceEn: futuro, enviadoEn: reciente },
      ],
    });
    await prisma.invitacion.createMany({
      data: [
        { tokenHash: "i".repeat(64), venceEn: viejo, creadaPorId: user.id },
        { tokenHash: "j".repeat(64), venceEn: futuro, creadaPorId: user.id },
      ],
    });
    await prisma.eventoAuditoria.create({
      data: { organizationId: org.id, actorTipo: "usuario", accion: "x", entidad: "y", entidadId: "z", creadoEn: viejo },
    });

    const r = await purgarOperativas(db, AHORA);
    expect(r).toEqual({ intentosAcceso: 1, sesionesAcceso: 2, passwordResets: 1, reservasHuerfanas: 1, invitaciones: 1 });
    expect(await prisma.sesionAcceso.count()).toBe(2);
    expect(await prisma.passwordReset.count()).toBe(2);
    expect(await prisma.invitacion.count()).toBe(1);
    // Nada clínico ni la auditoría se tocan por antigüedad.
    expect(await prisma.eventoAuditoria.count()).toBe(1);
  });

  it("re-cifra por tandas las filas con clave vieja y deja pendientes en 0; sin la clave vieja avisa y no rompe", async () => {
    const org = await prisma.organization.create({ data: { nombre: "Org" } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      ids.push(id);
      await db.paciente.create({
        data: { nombre: "N", apellido: "A", telefono: "", tarifa: 1, organizationId: org.id, ...cifrarPaciente(id, { notas: `nota ${i}` }) },
      });
    }
    const t = await prisma.turno.create({
      data: { id: randomUUID(), fecha: AHORA, tarifaCobrada: 1, pacienteId: ids[0], organizationId: org.id },
    });
    await db.turno.update({ where: { id: t.id }, data: cifrarTurno(t.id, { notas: "turno" }) });

    const K2 = randomBytes(32).toString("base64");
    llavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);

    const primera = await recifrarTanda(db, 3);
    expect(primera).toEqual({ recifradas: 3, pendientes: 3, errores: 0 });
    const segunda = await recifrarTanda(db, 200);
    expect(segunda).toEqual({ recifradas: 3, pendientes: 0, errores: 0 });

    const filas = await prisma.$queryRaw<{ notas_encrypted: Buffer }[]>`SELECT notas_encrypted FROM pacientes`;
    expect(filas.every((f) => idClaveDe(f.notas_encrypted) === 2)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect((await db.paciente.findUnique({ where: { id: ids[i] }, select: { notas: true } }))?.notas).toBe(`nota ${i}`);
    }
    expect((await db.turno.findUnique({ where: { id: t.id }, select: { notas: true } }))?.notas).toBe("turno");

    // Ya se puede sacar la 1: nada pendiente.
    llavero(`2=${K2}`);
    expect(await recifrarTanda(db)).toEqual({ recifradas: 0, pendientes: 0, errores: 0 });

    // Una fila que quedó con una clave ausente cuenta como error, se deja como
    // está y sigue pendiente: es la señal de "no saques la clave todavía".
    llavero(CLAVES_CIFRADO_TEST);
    const huerfana = await db.paciente.create({
      data: { nombre: "N", apellido: "A", telefono: "", tarifa: 1, organizationId: org.id, ...cifrarPaciente(randomUUID(), { notas: "con la 1" }) },
    });
    llavero(`2=${K2}`);
    const conError = await recifrarTanda(db);
    expect(conError).toEqual({ recifradas: 0, pendientes: 1, errores: 1 });
    const [fila] = await prisma.$queryRaw<{ notas_encrypted: Buffer }[]>`SELECT notas_encrypted FROM pacientes WHERE id = ${huerfana.id}`;
    expect(idClaveDe(fila.notas_encrypted)).toBe(1);
  });

  it("mantenimiento con `todo` encadena tandas hasta agotar", async () => {
    const org = await prisma.organization.create({ data: { nombre: "Org" } });
    for (let i = 0; i < 4; i++) {
      await db.paciente.create({
        data: { nombre: "N", apellido: "A", telefono: "", tarifa: 1, organizationId: org.id, ...cifrarPaciente(randomUUID(), { notas: "n" }) },
      });
    }
    llavero(`${CLAVES_CIFRADO_TEST},2=${randomBytes(32).toString("base64")}`);
    const r = await mantenimiento({ prisma: db, ahora: AHORA, todo: true });
    expect(r.recifrado).toEqual({ recifradas: 4, pendientes: 0, errores: 0 });
  });
});

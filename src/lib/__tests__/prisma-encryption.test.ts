/**
 * La extensión de cifrado: bloque unitario (sin base) y bloque de
 * integración contra la base de test (DATABASE_URL_TEST, esquema nuevo).
 *
 * Integración: ver base-identidad.ts. Este archivo está en la lista
 * INTEGRACION de vitest.config.ts.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aadDe, cifrar, descifrar, ErrorDescifrado } from "@/lib/encryption";
import { idClaveDe } from "./ayudantes";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  assertConsultaSinCifrados,
  assertEscrituraCifradaConsistente,
  CAMPOS_CIFRADOS,
  cifrarConsentimiento,
  cifrarHiloVersion,
  cifrarHotWord,
  cifrarPaciente,
  cifrarSesion,
  cifrarTurno,
  MODELOS_CIFRADOS,
  type ClienteCifrado,
} from "@/lib/prisma-encryption";

import {
  CLAVES_CIFRADO_TEST,
  conectarBaseIdentidad,
  hayBaseDeTest,
  vaciarBaseIdentidad,
} from "./base-identidad";

const ORIGINAL = process.env.CLAVES_CIFRADO;

function llavero(texto: string) {
  process.env.CLAVES_CIFRADO = texto;
  __resetLlaveroForTests();
}

// Al recolectar (los `describe` corren antes que cualquier hook) ya hace
// falta la clave: los blobs de ejemplo se arman en el cuerpo del describe.
llavero(CLAVES_CIFRADO_TEST);
beforeAll(() => llavero(CLAVES_CIFRADO_TEST));
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  __resetLlaveroForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// Unitario
// ─────────────────────────────────────────────────────────────────────────────

describe("la tabla de campos cifrados es la del anexo de docs/esquema.md", () => {
  it("seis modelos, con las columnas exactas", () => {
    expect(MODELOS_CIFRADOS.sort()).toEqual(
      ["ConsentimientoGrabacion", "HiloVersion", "HotWord", "Paciente", "SesionClinica", "Turno"].sort(),
    );
    expect(Object.keys(CAMPOS_CIFRADOS.SesionClinica.campos).sort()).toEqual(
      ["audioClave", "datos", "feedback", "notaFinal", "notaIa", "notasEdicion", "transcripcion"].sort(),
    );
    expect(CAMPOS_CIFRADOS.HotWord.campos.termino.columnaSql).toBe("termino_encrypted");
    expect(CAMPOS_CIFRADOS.HiloVersion.tabla).toBe("hilo_versiones");
  });
});

describe("cifrarX", () => {
  it("devuelve el id y solo las columnas de los campos enviados", () => {
    const r = cifrarPaciente("p1", { notas: "texto" });
    expect(r.id).toBe("p1");
    expect(Buffer.isBuffer(r.notasEncrypted)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["id", "notasEncrypted"]);
  });

  it("null deja la columna en null; undefined no la toca", () => {
    expect(cifrarTurno("t1", { notas: null }).notasEncrypted).toBeNull();
    expect(Object.keys(cifrarTurno("t1", {}))).toEqual(["id"]);
    expect(Object.keys(cifrarSesion("s1", { notaIa: undefined, datos: null }))).toEqual(["id", "datosEncrypted"]);
  });

  it("sin id no cifra: el AAD necesita la fila", () => {
    expect(() => cifrarPaciente("", { notas: "x" })).toThrow(/id de la fila es obligatorio/);
    // @ts-expect-error id inválido a propósito
    expect(() => cifrarSesion(undefined, { transcripcion: "x" })).toThrow();
  });

  it("el blob va atado a tabla, columna e id de la BASE", () => {
    const { notasEncrypted } = cifrarPaciente("p1", { notas: "texto" });
    const blob = notasEncrypted as Buffer;
    expect(descifrar(blob, aadDe("pacientes", "notas_encrypted", "p1"))).toBe("texto");
    expect(() => descifrar(blob, aadDe("turnos", "notas_encrypted", "p1"))).toThrow(ErrorDescifrado);
  });

  it("una nota SOAP se normaliza a sus cuatro claves antes de cifrar", () => {
    const { notaIaEncrypted } = cifrarSesion("s1", {
      notaIa: { subjetivo: "s", plan: "p", extra: "no" } as never,
    });
    const texto = descifrar(notaIaEncrypted as Buffer, aadDe("sesiones_clinicas", "nota_ia_encrypted", "s1"));
    expect(JSON.parse(texto)).toEqual({ subjetivo: "s", objetivo: null, analisis: null, plan: "p" });
  });

  it("json acepta objeto o string ya serializado", () => {
    const aad = aadDe("sesiones_clinicas", "datos_encrypted", "s1");
    expect(descifrar(cifrarSesion("s1", { datos: { a: 1 } }).datosEncrypted as Buffer, aad)).toBe('{"a":1}');
    expect(descifrar(cifrarSesion("s1", { datos: '{"b":2}' }).datosEncrypted as Buffer, aad)).toBe('{"b":2}');
  });

  it("rechaza un campo que no es cifrado", () => {
    expect(() => cifrarPaciente("p1", { nombre: "x" } as never)).toThrow(/no es un campo cifrado/);
  });
});

describe("guarda 1: nada cifrado en where / orderBy", () => {
  it.each(MODELOS_CIFRADOS)("%s rechaza el campo lógico y la columna, también anidados", (modelo) => {
    const [campo, def] = Object.entries(CAMPOS_CIFRADOS[modelo].campos)[0];
    expect(() => assertConsultaSinCifrados(modelo, { where: { [campo]: "x" } })).toThrow(/Cannot filter/);
    expect(() => assertConsultaSinCifrados(modelo, { where: { [def.columna]: null } })).toThrow(/Cannot filter/);
    expect(() =>
      assertConsultaSinCifrados(modelo, { where: { OR: [{ id: "a" }, { NOT: { [campo]: null } }] } }),
    ).toThrow(/Cannot filter/);
    expect(() => assertConsultaSinCifrados(modelo, { orderBy: [{ id: "asc" }, { [campo]: "asc" }] })).toThrow(
      /Cannot order/,
    );
    expect(() => assertConsultaSinCifrados(modelo, { where: { id: "a" }, orderBy: { id: "asc" } })).not.toThrow();
  });
});

describe("guarda 2: toda escritura cifrada lleva el id de su fila", () => {
  const blobP1 = cifrarPaciente("p1", { notas: "n" });

  it("create sin id con una columna cifrada se rechaza", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { notasEncrypted: blobP1.notasEncrypted } }),
    ).toThrow(/exige data.id/);
  });

  it("create con el id de otra fila se rechaza: el blob no es de esa fila", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { id: "p2", notasEncrypted: blobP1.notasEncrypted } }),
    ).toThrow(/no fue cifrado para la fila p2/);
  });

  it("create con el id correcto pasa; sin columnas cifradas no exige id", () => {
    expect(() => assertEscrituraCifradaConsistente("Paciente", "create", { data: blobP1 })).not.toThrow();
    expect(() => assertEscrituraCifradaConsistente("Paciente", "create", { data: { nombre: "x" } })).not.toThrow();
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { id: "p9", notasEncrypted: null } }),
    ).not.toThrow();
  });

  it("update/updateMany exigen where.id y que el blob sea de esa fila", () => {
    const { id: _id, ...data } = blobP1;
    void _id;
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "updateMany", { where: { organizationId: "o" }, data }),
    ).toThrow(/exige where.id/);
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "updateMany", { where: { id: "p2", organizationId: "o" }, data }),
    ).toThrow(/no fue cifrado para la fila p2/);
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "update", { where: { id: "p1" }, data }),
    ).not.toThrow();
  });

  it("upsert mira create.id y where.id", () => {
    const { id: _id, ...update } = blobP1;
    void _id;
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "upsert", { where: { id: "p1" }, create: blobP1, update }),
    ).not.toThrow();
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "upsert", { where: { id: "p2" }, create: blobP1, update }),
    ).toThrow(/no fue cifrado para la fila p2/);
  });

  it("createMany revisa cada fila", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("HotWord", "createMany", {
        data: [cifrarHotWord("h1", { termino: "a" }), { terminoEncrypted: cifrarHotWord("h2", { termino: "b" }).terminoEncrypted }],
      }),
    ).toThrow(/exige data.id/);
  });

  it("un valor que no es blob en una columna cifrada se rechaza", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Turno", "create", { data: { id: "t1", notasEncrypted: "texto plano" } }),
    ).toThrow(/solo acepta un blob/);
  });

  it("las lecturas no pasan por la guarda 2", () => {
    expect(() => assertEscrituraCifradaConsistente("Paciente", "findMany", { where: { id: "x" } })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integración
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hayBaseDeTest())("extensión contra la base de test", () => {
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

  it("sesión clínica: los siete campos lógicos van y vuelven; audioClave se destruye con null", async () => {
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
          audioClave: "Y2xhdmU=",
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
      select: { audioClave: true, transcripcion: true, notaIa: true, datos: true, feedback: true, notaFinal: true, notasEdicion: true },
    });
    expect(s).toMatchObject({
      audioClave: "Y2xhdmU=",
      transcripcion: "T: hola\nP: hola",
      notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" },
      datos: { riesgoDetectado: { nivel: "ninguno" } },
      feedback: { puntaje: 3 },
      notaFinal: null,
      notasEdicion: null,
    });

    await db.sesionClinica.updateMany({
      where: { id, organizationId: org.id },
      data: { estado: "aprobada", ...cifrarSesion(id, { audioClave: null, notaFinal: { subjetivo: "s2", objetivo: null, analisis: null, plan: null }, notasEdicion: "ok" }) },
    });
    const s2 = await db.sesionClinica.findUniqueOrThrow({ where: { id }, select: { audioClave: true, notaFinal: true, notasEdicion: true } });
    expect(s2.audioClave).toBeNull();
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
    void cifrar;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mantenimiento: purgas a 30 días y re-cifrado incremental (mismo archivo
// porque está en la lista INTEGRACION y usa la misma base).
// ─────────────────────────────────────────────────────────────────────────────

import {
  celdasCifradas,
  mantenimiento,
  purgarOperativas,
  recifrarTanda,
  RESERVA_HUERFANA_MS,
  RETENCION_OPERATIVA_DIAS,
} from "@/app/api/_lib/casos-uso/mantenimiento";

describe.skipIf(!hayBaseDeTest())("mantenimiento contra la base de test", () => {
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

  it("celdasCifradas enumera las trece columnas del anexo", () => {
    expect(celdasCifradas()).toHaveLength(13);
    expect(celdasCifradas()).toContainEqual({ tabla: "hilo_versiones", columna: "contenido_encrypted" });
  });

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

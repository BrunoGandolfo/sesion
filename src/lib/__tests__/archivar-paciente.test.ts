/**
 * Integración — archivar a una paciente, contra la base real.
 *
 * En UNA transacción: la paciente queda archivada y queda un evento de
 * auditoría. Si el evento no se puede escribir, no queda archivada. Una
 * paciente archivada sale de la lista de avisos de Hoy (la consulta sólo
 * toma pacientes activas: recordatorios-whatsapp.test.ts).
 *
 * La auditoría se rompe como en auditoria-transaccional.test.ts: un trigger
 * que hace fallar el INSERT en la base de verdad.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/archivar-paciente.test.ts
 */
import { ACCIONES } from "@/lib/auditoria-acciones";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { actualizarPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const AHORA = new Date("2026-09-03T15:00:00.000Z");
const MANANA = new Date("2026-09-04T15:00:00.000Z");
const USUARIO = "usuario-que-archiva";

async function fixture() {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Lucía", apellido: "Gómez", telefono: "+59899123456", tarifa: 1000, organizationId: org.id },
  });
  const turno = await prismaRaw.turno.create({
    data: { fecha: MANANA, estado: "programado", tarifaCobrada: 1000, pacienteId: paciente.id, organizationId: org.id },
  });
  return { organizationId: org.id, pacienteId: paciente.id, turnoId: turno.id };
}

const archivar = (f: { organizationId: string; pacienteId: string }, ahora = AHORA) =>
  actualizarPaciente({
    prisma: db,
    organizationId: f.organizationId,
    pacienteId: f.pacienteId,
    cambios: { activo: false },
    usuarioId: USUARIO,
    ahora,
  });

const pacienteDe = (id: string) => prismaRaw.paciente.findUniqueOrThrow({ where: { id } });
const eventos = () => prismaRaw.eventoAuditoria.findMany({ orderBy: { creadoEn: "asc" } });

async function romperAuditoria() {
  await prismaRaw.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION auditoria_caida() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'auditoria caida'; END;
    $$ LANGUAGE plpgsql;`);
  await prismaRaw.$executeRawUnsafe(`
    CREATE TRIGGER auditoria_caida BEFORE INSERT ON eventos_auditoria
    FOR EACH ROW EXECUTE FUNCTION auditoria_caida();`);
}

async function repararAuditoria() {
  await prismaRaw.$executeRawUnsafe(`DROP TRIGGER IF EXISTS auditoria_caida ON eventos_auditoria;`);
  await prismaRaw.$executeRawUnsafe(`DROP FUNCTION IF EXISTS auditoria_caida();`);
}

beforeAll(() => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await repararAuditoria();
  await vaciarTablas(prismaRaw);
});

afterEach(async () => {
  await repararAuditoria();
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("archivar a la paciente", () => {
  it("deja un evento de auditoría con quién y cuándo", async () => {
    const f = await fixture();
    await archivar(f);

    const [evento, ...resto] = await eventos();
    expect(resto).toHaveLength(0);
    expect(evento).toMatchObject({
      organizationId: f.organizationId,
      actorTipo: "usuario",
      actorId: USUARIO,
      accion: ACCIONES.paciente.archivar,
      entidad: "paciente",
      entidadId: f.pacienteId,
    });
    expect(evento.creadoEn.getTime()).toBe(AHORA.getTime());
    expect((await pacienteDe(f.pacienteId)).activo).toBe(false);
  });

  it("una paciente de otra organización es 404 y no archiva nada", async () => {
    const f = await fixture();
    const otra = await fixture();
    await expect(
      archivar({ organizationId: otra.organizationId, pacienteId: f.pacienteId }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await pacienteDe(f.pacienteId)).activo).toBe(true);
    expect(await eventos()).toHaveLength(0);
  });

  it("si la auditoría falla, la paciente NO queda archivada", async () => {
    const f = await fixture();
    await romperAuditoria();
    await expect(archivar(f)).rejects.toThrow(/auditoria caida/);
    await repararAuditoria();
    expect((await pacienteDe(f.pacienteId)).activo).toBe(true);
    expect(await eventos()).toHaveLength(0);
  });

  it("archivar dos veces audita una sola", async () => {
    const f = await fixture();
    await archivar(f);
    await archivar(f);
    expect(await eventos()).toHaveLength(1);
  });

  it("volver a activarla queda como edición, no como archivo", async () => {
    const f = await fixture();
    await archivar(f);
    const paciente = await actualizarPaciente({
      prisma: db,
      organizationId: f.organizationId,
      pacienteId: f.pacienteId,
      cambios: { activo: true },
      usuarioId: USUARIO,
      ahora: MANANA,
    });
    expect(paciente.activo).toBe(true);
    expect((await eventos()).map((e) => [e.accion, e.detalle])).toEqual([
      [ACCIONES.paciente.archivar, {}],
      [ACCIONES.paciente.editar, { campos: ["activo"] }],
    ]);
  });

  it("editar otros datos (sin archivar) deja paciente.editar con el nombre del campo", async () => {
    const f = await fixture();
    await actualizarPaciente({
      prisma: db,
      organizationId: f.organizationId,
      pacienteId: f.pacienteId,
      cambios: { nombre: "Lucía María" },
      usuarioId: USUARIO,
    });
    expect((await eventos()).map((e) => [e.accion, e.detalle])).toEqual([[ACCIONES.paciente.editar, { campos: ["nombre"] }]]);
  });

  it("archivar junto con otros cambios los aplica todos en la misma escritura", async () => {
    const f = await fixture();
    const paciente = await actualizarPaciente({
      prisma: db,
      organizationId: f.organizationId,
      pacienteId: f.pacienteId,
      cambios: { activo: false, tarifa: 1500, notas: "privada" },
      usuarioId: USUARIO,
      ahora: AHORA,
    });
    expect(paciente).toMatchObject({ activo: false, tarifa: 1500 });
    const fila = await db.paciente.findUniqueOrThrow({ where: { id: f.pacienteId } });
    expect(fila.notas).toBe("privada");
  });
});

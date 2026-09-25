/**
 * Integración — archivar a una paciente apaga sus SMS, contra la base real.
 *
 * Antes, archivar (`actualizarPaciente` con `activo: false`) sólo cambiaba la
 * columna: los recordatorios ya programados seguían saliendo. Ahora, en UNA
 * transacción: la paciente queda archivada, sus envíos `pendiente` o
 * `enviando` pasan a `cancelado` con motivo y `cerradoEn`, y queda un evento
 * de auditoría. Si el evento no se puede escribir, no pasa nada de lo otro.
 *
 * La auditoría se rompe como en auditoria-transaccional.test.ts: un trigger
 * que hace fallar el INSERT en la base de verdad.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/archivar-paciente.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { EstadoEnvioSms, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ACCION_ARCHIVAR, actualizarPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { MOTIVO_PACIENTE_ARCHIVADA } from "@/app/api/_lib/casos-uso/envios-del-turno";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const AHORA = new Date("2026-09-03T15:00:00.000Z");
const MANANA = new Date("2026-09-04T15:00:00.000Z");
const AYER = new Date("2026-09-02T15:00:00.000Z");
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

/** Un envío de la paciente en el estado pedido. Sin turno es un aviso de cobro. */
async function envio(
  f: { organizationId: string; pacienteId: string; turnoId: string },
  estado: EstadoEnvioSms,
  extra: { conTurno?: boolean; motivoNoEnvio?: string | null; cerradoEn?: Date | null } = {},
) {
  const conTurno = extra.conTurno ?? true;
  const fila = await prismaRaw.envioSms.create({
    data: {
      organizationId: f.organizationId,
      claveIdempotencia: `test:${randomUUID()}`,
      motivo: conTurno ? "recordatorio_turno" : "recordatorio_cobro",
      estado,
      pacienteId: f.pacienteId,
      turnoId: conTurno ? f.turnoId : null,
      destino: "+59899123456",
      programadoEn: AHORA,
      proximoIntentoEn: estado === "pendiente" || estado === "enviando" ? AHORA : null,
      motivoNoEnvio: extra.motivoNoEnvio ?? null,
      cerradoEn: extra.cerradoEn ?? null,
      ...(estado === "aceptado" || estado === "entregado" ? { sid: `SM${randomUUID()}`, aceptadoEn: AYER } : {}),
    },
  });
  return fila.id;
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

const leer = (id: string) => prismaRaw.envioSms.findUniqueOrThrow({ where: { id } });
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
  it("cancela sus envíos pendientes (de turno y de cobro) y los que estaban enviándose, con motivo y cerradoEn", async () => {
    const f = await fixture();
    const deTurno = await envio(f, "pendiente");
    const deCobro = await envio(f, "pendiente", { conTurno: false });
    const reservado = await envio(f, "enviando");

    const paciente = await archivar(f);

    expect(paciente.activo).toBe(false);
    expect((await pacienteDe(f.pacienteId)).activo).toBe(false);
    for (const id of [deTurno, deCobro, reservado]) {
      const fila = await leer(id);
      expect(fila).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_PACIENTE_ARCHIVADA });
      expect(fila.cerradoEn?.getTime()).toBe(AHORA.getTime());
    }
  });

  it("deja un evento de auditoría con quién, cuándo y cuántos envíos apagó", async () => {
    const f = await fixture();
    await envio(f, "pendiente");
    await envio(f, "pendiente", { conTurno: false });

    await archivar(f);

    const [evento, ...resto] = await eventos();
    expect(resto).toHaveLength(0);
    expect(evento).toMatchObject({
      organizationId: f.organizationId,
      actorTipo: "usuario",
      actorId: USUARIO,
      accion: ACCION_ARCHIVAR,
      entidad: "paciente",
      entidadId: f.pacienteId,
      detalle: { enviosCancelados: 2, yaEstabaArchivada: false },
    });
    expect(evento.creadoEn.getTime()).toBe(AHORA.getTime());
  });

  it("sin envíos pendientes igual audita el archivado", async () => {
    const f = await fixture();
    await archivar(f);
    const [evento] = await eventos();
    expect(evento).toMatchObject({ accion: ACCION_ARCHIVAR, detalle: { enviosCancelados: 0, yaEstabaArchivada: false } });
  });

  it("no toca los envíos ya aceptados, entregados, cancelados, fallidos ni desconocidos", async () => {
    const f = await fixture();
    const cerrados = {
      aceptado: await envio(f, "aceptado"),
      entregado: await envio(f, "entregado", { cerradoEn: AYER }),
      cancelado: await envio(f, "cancelado", { motivoNoEnvio: "el turno dejó de estar programado", cerradoEn: AYER }),
      fallido: await envio(f, "fallido", { motivoNoEnvio: "el teléfono no es válido", cerradoEn: AYER }),
      desconocido: await envio(f, "desconocido", { motivoNoEnvio: "Twilio no respondió" }),
    };
    const antes = await Promise.all(Object.values(cerrados).map(leer));

    await archivar(f);

    const despues = await Promise.all(Object.values(cerrados).map(leer));
    expect(despues).toEqual(antes);
    expect((await eventos())[0].detalle).toMatchObject({ enviosCancelados: 0 });
  });

  it("no toca los envíos de otra paciente ni de otra organización", async () => {
    const f = await fixture();
    const otra = await fixture();
    const ajeno = await envio(otra, "pendiente");
    await envio(f, "pendiente");

    await archivar(f);

    expect((await leer(ajeno)).estado).toBe("pendiente");
  });

  it("una paciente de otra organización es 404 y no apaga nada", async () => {
    const f = await fixture();
    const otra = await fixture();
    const id = await envio(f, "pendiente");

    await expect(
      archivar({ organizationId: otra.organizationId, pacienteId: f.pacienteId }),
    ).rejects.toMatchObject({ status: 404 });

    expect((await pacienteDe(f.pacienteId)).activo).toBe(true);
    expect((await leer(id)).estado).toBe("pendiente");
    expect(await eventos()).toHaveLength(0);
  });

  it("si la auditoría falla, la paciente NO queda archivada y sus envíos siguen pendientes", async () => {
    const f = await fixture();
    const id = await envio(f, "pendiente");
    await romperAuditoria();

    await expect(archivar(f)).rejects.toThrow(/auditoria caida/);

    await repararAuditoria();
    expect((await pacienteDe(f.pacienteId)).activo).toBe(true);
    expect(await leer(id)).toMatchObject({ estado: "pendiente", motivoNoEnvio: null, cerradoEn: null });
    expect(await eventos()).toHaveLength(0);
  });

  it("archivar dos veces no audita dos veces si no hubo nada que apagar", async () => {
    const f = await fixture();
    await archivar(f);
    await archivar(f);
    expect(await eventos()).toHaveLength(1);
  });

  it("archivar de nuevo apaga lo que haya quedado pendiente de antes, y lo audita", async () => {
    // Una paciente archivada antes de este cambio: la columna en false y un
    // envío vivo. Volver a archivarla lo limpia.
    const f = await fixture();
    await prismaRaw.paciente.update({ where: { id: f.pacienteId }, data: { activo: false } });
    const id = await envio(f, "pendiente");

    await archivar(f);

    expect(await leer(id)).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_PACIENTE_ARCHIVADA });
    const [evento] = await eventos();
    expect(evento.detalle).toMatchObject({ enviosCancelados: 1, yaEstabaArchivada: true });
  });

  it("volver a activarla NO revive los envíos cancelados, y no audita", async () => {
    const f = await fixture();
    const id = await envio(f, "pendiente");
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
    const fila = await leer(id);
    expect(fila).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_PACIENTE_ARCHIVADA });
    expect(fila.cerradoEn?.getTime()).toBe(AHORA.getTime());
    expect(await eventos()).toHaveLength(1);
  });

  it("editar otros datos (sin archivar) no toca los envíos ni audita", async () => {
    const f = await fixture();
    const id = await envio(f, "pendiente");

    await actualizarPaciente({
      prisma: db,
      organizationId: f.organizationId,
      pacienteId: f.pacienteId,
      cambios: { nombre: "Lucía María" },
      usuarioId: USUARIO,
    });

    expect((await leer(id)).estado).toBe("pendiente");
    expect(await eventos()).toHaveLength(0);
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

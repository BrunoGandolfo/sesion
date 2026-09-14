/**
 * Integración — recordarCobro y ultimoAvisoPorPaciente contra la base real
 * de test. Twilio no interviene: acá no se manda nada, se CREA el envío en
 * envios_sms y lo manda el cron (despachar-sms.test.ts prueba esa parte).
 *
 * Lo que se prueba: que el aviso quede en cola con la deuda real y el
 * teléfono congelado, que dos toques el mismo día sean un solo envío, que no
 * se le avise a quien no debe (ni a quien pidió la baja), y que la pantalla
 * pueda saber cuándo fue el último aviso que SALIÓ.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5433/sesion_test" \
 *   npx vitest run src/lib/__tests__/recordar-cobro.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type { EventoAuditoriaInput } from "@/app/api/_lib/auditoria-pura";
import { claveDeCobro } from "@/app/api/_lib/casos-uso/envios-del-turno";
import {
  ACCION_AVISO,
  MOTIVO_PACIENTE_DADA_DE_BAJA,
  recordarCobro,
  ultimoAvisoPorPaciente,
} from "@/app/api/_lib/casos-uso/recordar-cobro";
import { ApiError } from "@/app/api/_lib/responses";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TARIFA = 1200;
const TELEFONO = "+59899123456";

type Base = { orgId: string; pacienteId: string };

async function crearBase(): Promise<Base> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  await prismaRaw.configuracion.create({
    data: { organizationId: org.id, nombreProfesional: "Mariana Roldán", tarifaDefault: TARIFA },
  });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Lucía", apellido: "Fernández", telefono: TELEFONO, tarifa: TARIFA, organizationId: org.id },
  });
  return { orgId: org.id, pacienteId: paciente.id };
}

/** Turno realizado e impago: lo que cuenta como deuda. */
async function crearImpago(base: Base, diasAtras: number): Promise<void> {
  await prismaRaw.turno.create({
    data: {
      fecha: new Date(AHORA.getTime() - diasAtras * 86_400_000),
      duracion: 50,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: TARIFA,
      pacienteId: base.pacienteId,
      organizationId: base.orgId,
    },
  });
}

function stubAuditoria() {
  const eventos: EventoAuditoriaInput[] = [];
  return {
    eventos,
    registrarAuditoria: async (evento: EventoAuditoriaInput) => {
      eventos.push(evento);
    },
  };
}

const enviosDe = (pacienteId: string) =>
  prismaRaw.envioSms.findMany({ where: { pacienteId }, orderBy: { creadoEn: "asc" } });

beforeAll(() => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
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

describe("recordarCobro", () => {
  it("deja el aviso en cola con la deuda real, el teléfono congelado y quién lo pidió", async () => {
    const base = await crearBase();
    await crearImpago(base, 40);
    await crearImpago(base, 12);
    const auditoria = stubAuditoria();

    const resultado = await recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      usuarioId: "user-1",
      registrarAuditoria: auditoria.registrarAuditoria,
      ahora: AHORA,
    });

    expect(resultado).toMatchObject({
      creado: true,
      programadoEn: AHORA.toISOString(),
      sesiones: 2,
      monto: 2 * TARIFA,
    });

    const envios = await enviosDe(base.pacienteId);
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({
      id: resultado.envioId,
      organizationId: base.orgId,
      motivo: "recordatorio_cobro",
      estado: "pendiente",
      destino: TELEFONO,
      turnoId: null,
      claveIdempotencia: claveDeCobro(base.pacienteId, AHORA),
      programadoEn: AHORA,
      proximoIntentoEn: AHORA,
      intentos: 0,
    });

    expect(auditoria.eventos).toHaveLength(1);
    const evento = auditoria.eventos[0];
    expect(evento).toMatchObject({
      accion: ACCION_AVISO,
      entidad: "paciente",
      entidadId: base.pacienteId,
      actorTipo: "usuario",
      actorId: "user-1",
      detalle: { sesiones: 2, monto: 2 * TARIFA, envioId: resultado.envioId },
    });
    // Ni el teléfono ni el nombre entran al registro.
    const serializado = JSON.stringify(evento);
    expect(serializado).not.toContain(TELEFONO);
    expect(serializado).not.toContain("Lucía");
  });

  it("dos toques el mismo día son un solo envío y un solo evento", async () => {
    const base = await crearBase();
    await crearImpago(base, 5);
    const auditoria = stubAuditoria();
    const pedir = () =>
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      });

    const primero = await pedir();
    const segundo = await pedir();

    expect(primero.creado).toBe(true);
    expect(segundo.creado).toBe(false);
    expect(segundo.envioId).toBe(primero.envioId);
    expect(await enviosDe(base.pacienteId)).toHaveLength(1);
    expect(auditoria.eventos).toHaveLength(1);
  });

  it("a quien no debe nada no se le avisa: 409 y no se crea nada", async () => {
    const base = await crearBase();
    await prismaRaw.turno.create({
      data: {
        fecha: new Date(AHORA.getTime() - 86_400_000),
        duracion: 50,
        estado: "realizado",
        pagoEstado: "pagado",
        tarifaCobrada: TARIFA,
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
      },
    });
    const auditoria = stubAuditoria();

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
    expect(auditoria.eventos).toHaveLength(0);
  });

  it("una paciente de otra organización no existe para esta", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearImpago(otra, 10);
    const auditoria = stubAuditoria();

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: otra.pacienteId,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await enviosDe(otra.pacienteId)).toHaveLength(0);
  });

  it("sin teléfono cargado no hay a dónde mandarlo: 409", async () => {
    const base = await crearBase();
    await crearImpago(base, 3);
    await prismaRaw.paciente.update({ where: { id: base.pacienteId }, data: { telefono: "   " } });
    const auditoria = stubAuditoria();

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
  });

  it("un teléfono dado de baja: 409 con el motivo y no se crea nada", async () => {
    const base = await crearBase();
    await crearImpago(base, 3);
    await prismaRaw.bajaSms.create({ data: { telefono: TELEFONO, motivo: "respuesta_baja" } });
    const auditoria = stubAuditoria();

    const error = await recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      registrarAuditoria: auditoria.registrarAuditoria,
      ahora: AHORA,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe(MOTIVO_PACIENTE_DADA_DE_BAJA);
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
  });
});

describe("ultimoAvisoPorPaciente", () => {
  type Estado = "pendiente" | "aceptado" | "entregado" | "no_entregado" | "fallido";

  async function crearEnvio(
    base: Base,
    opciones: { estado: Estado; aceptadoEn: Date | null; pacienteId?: string; motivo?: "recordatorio_cobro" | "recordatorio_turno" },
  ): Promise<void> {
    await prismaRaw.envioSms.create({
      data: {
        organizationId: base.orgId,
        claveIdempotencia: `k:${randomUUID()}`,
        motivo: opciones.motivo ?? "recordatorio_cobro",
        estado: opciones.estado,
        pacienteId: opciones.pacienteId ?? base.pacienteId,
        destino: TELEFONO,
        programadoEn: AHORA,
        aceptadoEn: opciones.aceptadoEn,
        sid: opciones.aceptadoEn ? `SM${randomUUID().replaceAll("-", "")}` : null,
      },
    });
  }

  it("devuelve el aviso más reciente que SALIÓ de cada paciente", async () => {
    const base = await crearBase();
    const otra = await prismaRaw.paciente.create({
      data: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000002", tarifa: TARIFA, organizationId: base.orgId },
    });
    const viejo = new Date("2026-08-01T12:00:00.000Z");
    const nuevo = new Date("2026-09-01T12:00:00.000Z");
    await crearEnvio(base, { estado: "entregado", aceptadoEn: viejo });
    await crearEnvio(base, { estado: "aceptado", aceptadoEn: nuevo });
    await crearEnvio(base, { estado: "aceptado", aceptadoEn: viejo, pacienteId: otra.id });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId, otra.id]);

    expect(mapa.get(base.pacienteId)).toBe(nuevo.toISOString());
    expect(mapa.get(otra.id)).toBe(viejo.toISOString());
  });

  it("uno en cola, fallido o no entregado no cuenta como aviso; un recordatorio de turno tampoco", async () => {
    const base = await crearBase();
    await crearEnvio(base, { estado: "pendiente", aceptadoEn: null });
    await crearEnvio(base, { estado: "fallido", aceptadoEn: null });
    await crearEnvio(base, { estado: "no_entregado", aceptadoEn: new Date("2026-09-01T12:00:00.000Z") });
    await crearEnvio(base, { estado: "entregado", aceptadoEn: new Date("2026-09-02T12:00:00.000Z"), motivo: "recordatorio_turno" });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId]);

    expect(mapa.has(base.pacienteId)).toBe(false);
  });

  it("no cruza organizaciones ni inventa avisos", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearEnvio(otra, { estado: "aceptado", aceptadoEn: new Date("2026-09-01T12:00:00.000Z") });

    // El id existe, pero el aviso es de otra organización.
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [otra.pacienteId, base.pacienteId]);

    expect(mapa.size).toBe(0);
  });

  it("sin pacientes no consulta nada", async () => {
    const base = await crearBase();
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, []);
    expect(mapa.size).toBe(0);
  });
});

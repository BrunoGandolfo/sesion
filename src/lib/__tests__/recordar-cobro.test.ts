/**
 * Integración — recordarCobro y ultimoAvisoPorPaciente contra la DB real de
 * test (DATABASE_URL_TEST). Twilio no interviene: el envío es un stub
 * inyectado, igual que en casos-uso-recordatorios.
 *
 * Lo que se prueba acá es el aviso de cobro por SMS: que salga con la deuda
 * que la paciente realmente tiene, que quede el rastro (y también cuando
 * falla), que no se le avise a quien no debe, y que la pantalla pueda saber
 * cuándo fue el último aviso para no mandarlo dos veces.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/recordar-cobro.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  ACCION_AVISO,
  ACCION_AVISO_FALLIDO,
  recordarCobro,
  ultimoAvisoPorPaciente,
  type EnviarSms,
} from "@/app/api/_lib/casos-uso/recordar-cobro";
import type { EventoAuditoriaInput } from "@/app/api/_lib/auditoria-pura";
import { ApiError } from "@/app/api/_lib/responses";
import { SMS_NO_ENVIADO } from "@/lib/glosario";
import type { SmsMessage } from "@/lib/recordatorios-sms";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TARIFA = 1200;

type Base = { orgId: string; pacienteId: string };

async function crearBase(opciones: { nombreProfesional?: string } = {}) {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      nombreProfesional: opciones.nombreProfesional ?? "Mariana Roldán",
      tarifaDefault: TARIFA,
    },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Lucía",
      apellido: "Fernández",
      telefono: "+59899123456",
      tarifa: TARIFA,
      organizationId: org.id,
    },
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

/** Stub del envío: registra lo que se le pidió mandar. */
function stubSms(resultado: { success: boolean; sid?: string; error?: string }) {
  const enviados: SmsMessage[] = [];
  const enviarSms: EnviarSms = async (mensaje) => {
    enviados.push(mensaje);
    return resultado;
  };
  return { enviados, enviarSms };
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

beforeAll(() => {
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
});

describe("recordarCobro", () => {
  it("manda el SMS con la deuda real y lo deja auditado", async () => {
    const base = await crearBase();
    await crearImpago(base, 40);
    await crearImpago(base, 12);

    const sms = stubSms({ success: true, sid: "SM123" });
    const auditoria = stubAuditoria();

    const resultado = await recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      usuarioId: "user-1",
      enviarSms: sms.enviarSms,
      registrarAuditoria: auditoria.registrarAuditoria,
      ahora: AHORA,
    });

    expect(resultado).toEqual({
      enviadoEn: AHORA.toISOString(),
      sesiones: 2,
      monto: 2 * TARIFA,
      sid: "SM123",
    });

    // Sale al teléfono de la paciente, con su nombre, la cuenta bien hecha y
    // la firma de la profesional.
    expect(sms.enviados).toHaveLength(1);
    expect(sms.enviados[0].to).toBe("+59899123456");
    expect(sms.enviados[0].text).toContain("Lucía");
    expect(sms.enviados[0].text).toContain("2 sesiones pendientes");
    expect(sms.enviados[0].text).toContain("$ 2.400");
    expect(sms.enviados[0].text).toContain("Mariana Roldán");

    expect(auditoria.eventos).toHaveLength(1);
    const evento = auditoria.eventos[0];
    expect(evento.accion).toBe(ACCION_AVISO);
    expect(evento.entidad).toBe("paciente");
    expect(evento.entidadId).toBe(base.pacienteId);
    expect(evento.actorTipo).toBe("usuario");
    expect(evento.actorId).toBe("user-1");
    expect(evento.detalle).toEqual({
      sesiones: 2,
      monto: 2 * TARIFA,
      sid: "SM123",
    });

    // Ni el texto del mensaje ni el teléfono entran al registro.
    const serializado = JSON.stringify(evento);
    expect(serializado).not.toContain("+59899123456");
    expect(serializado).not.toContain("Lucía");
  });

  it("si Twilio rechaza, sube un texto estable y el motivo real queda en la auditoría", async () => {
    const base = await crearBase();
    await crearImpago(base, 5);

    const sms = stubSms({
      success: false,
      error: "Twilio 21610: número dado de baja",
    });
    const auditoria = stubAuditoria();

    const promesa = recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      usuarioId: "user-1",
      enviarSms: sms.enviarSms,
      registrarAuditoria: auditoria.registrarAuditoria,
      ahora: AHORA,
    });

    // Lo que llega a la pantalla: el texto del glosario y nada más.
    await expect(promesa).rejects.toThrow(SMS_NO_ENVIADO);
    await expect(promesa).rejects.toBeInstanceOf(ApiError);
    await expect(promesa).rejects.toMatchObject({ status: 502 });

    // Lo que Twilio dijo de verdad: en el evento, que es donde sirve.
    expect(auditoria.eventos).toHaveLength(1);
    expect(auditoria.eventos[0].accion).toBe(ACCION_AVISO_FALLIDO);
    expect(auditoria.eventos[0].detalle).toEqual({
      sesiones: 1,
      monto: TARIFA,
      error: "Twilio 21610: número dado de baja",
    });
  });

  it("un fallo de configuración no le muestra el nombre de la variable", async () => {
    const base = await crearBase();
    await crearImpago(base, 5);

    // Lo que devuelve sendSms cuando falta el número de Twilio: el motivo
    // nombra una variable de entorno, y eso no puede llegar a la pantalla.
    const sms = stubSms({
      success: false,
      error: "SMS no configurado: falta TWILIO_SMS_FROM",
    });
    const auditoria = stubAuditoria();

    const promesa = recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      enviarSms: sms.enviarSms,
      registrarAuditoria: auditoria.registrarAuditoria,
      ahora: AHORA,
    });

    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(SMS_NO_ENVIADO);
    expect((error as ApiError).message).not.toContain("TWILIO");

    expect(auditoria.eventos[0].detalle).toMatchObject({
      error: "SMS no configurado: falta TWILIO_SMS_FROM",
    });
  });

  it("a quien no debe nada no se le avisa: 409 y no se manda nada", async () => {
    const base = await crearBase();
    // Una sesión realizada y ya cobrada: no es deuda.
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

    const sms = stubSms({ success: true, sid: "SM123" });
    const auditoria = stubAuditoria();

    const llamar = () =>
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        enviarSms: sms.enviarSms,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      });

    await expect(llamar()).rejects.toMatchObject({ status: 409 });
    expect(sms.enviados).toHaveLength(0);
    expect(auditoria.eventos).toHaveLength(0);
  });

  it("una paciente de otra organización no existe para esta", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearImpago(otra, 10);

    const sms = stubSms({ success: true });
    const auditoria = stubAuditoria();

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: otra.pacienteId,
        enviarSms: sms.enviarSms,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sms.enviados).toHaveLength(0);
  });

  it("sin teléfono cargado no hay a dónde mandarlo: 409", async () => {
    const base = await crearBase();
    await crearImpago(base, 3);
    await prismaRaw.paciente.update({
      where: { id: base.pacienteId },
      data: { telefono: "   " },
    });

    const sms = stubSms({ success: true });
    const auditoria = stubAuditoria();

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        enviarSms: sms.enviarSms,
        registrarAuditoria: auditoria.registrarAuditoria,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(sms.enviados).toHaveLength(0);
  });
});

describe("ultimoAvisoPorPaciente", () => {
  async function crearEvento(
    base: Base,
    opciones: { accion: string; createdAt: Date; pacienteId?: string },
  ): Promise<void> {
    const evento = await prismaRaw.eventoAuditoria.create({
      data: {
        organizationId: base.orgId,
        actorTipo: "usuario",
        accion: opciones.accion,
        entidad: "paciente",
        entidadId: opciones.pacienteId ?? base.pacienteId,
      },
      select: { id: true },
    });
    // createdAt es @default(now()): para fechar el evento en el pasado hay
    // que pisarlo por SQL.
    await prismaRaw.$executeRawUnsafe(
      `UPDATE eventos_auditoria SET created_at = $1 WHERE id = $2`,
      opciones.createdAt,
      evento.id,
    );
  }

  it("devuelve el aviso más reciente de cada paciente", async () => {
    const base = await crearBase();
    const otra = await prismaRaw.paciente.create({
      data: {
        nombre: "Ana",
        apellido: "Pérez",
        telefono: "+59899000002",
        tarifa: TARIFA,
        organizationId: base.orgId,
      },
    });

    const viejo = new Date("2026-08-01T12:00:00.000Z");
    const nuevo = new Date("2026-09-01T12:00:00.000Z");
    await crearEvento(base, { accion: ACCION_AVISO, createdAt: viejo });
    await crearEvento(base, { accion: ACCION_AVISO, createdAt: nuevo });
    await crearEvento(base, {
      accion: ACCION_AVISO,
      createdAt: viejo,
      pacienteId: otra.id,
    });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [
      base.pacienteId,
      otra.id,
    ]);

    expect(mapa.get(base.pacienteId)).toBe(nuevo.toISOString());
    expect(mapa.get(otra.id)).toBe(viejo.toISOString());
  });

  it("un intento fallido no cuenta como aviso", async () => {
    const base = await crearBase();
    await crearEvento(base, {
      accion: ACCION_AVISO_FALLIDO,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [
      base.pacienteId,
    ]);

    expect(mapa.has(base.pacienteId)).toBe(false);
  });

  it("no cruza organizaciones ni inventa avisos", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearEvento(otra, {
      accion: ACCION_AVISO,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    // El id existe, pero el aviso es de otra organización.
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [
      otra.pacienteId,
      base.pacienteId,
    ]);

    expect(mapa.size).toBe(0);
  });

  it("sin pacientes no consulta nada", async () => {
    const base = await crearBase();
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, []);
    expect(mapa.size).toBe(0);
  });
});

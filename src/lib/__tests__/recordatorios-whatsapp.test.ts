/**
 * Integración — WhatsApp asistido contra la base real de test
 * (DATABASE_URL_TEST). Twilio no interviene: el enviador es un doble.
 *
 * Lo que protege:
 *   - "Qué turnos corresponde avisar hoy" sale de envios_sms.programado_en,
 *     no de recalcular la ventana: un envío programado hoy entra aunque la
 *     cuenta del modo dijera otro día, y al revés.
 *   - El texto del enlace es el mismo que el cron le manda a Twilio.
 *   - Con canal `whatsapp` el cron cancela el recordatorio con su motivo y no
 *     llama a Twilio; con `ambos` (y `sms`) manda como siempre. Lo decide al
 *     despachar: cambiar la configuración alcanza a lo ya agendado.
 *   - Registrar la apertura: fila + auditoría, repetible, 404 si es ajeno.
 *   - El contrato exacto de las dos rutas y el PATCH de /api/config.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/recordatorios-whatsapp.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { CanalRecordatorio, PrismaClient } from "@prisma/client";

import { despacharEnvios } from "@/app/api/_lib/casos-uso/despachar-sms";
import {
  claveDelTurno,
  MOTIVO_CANAL_WHATSAPP,
  programarEnvioDelTurno,
} from "@/app/api/_lib/casos-uso/envios-del-turno";
import { correspondeAvisarHoy, listarRecordatoriosDeHoy, registrarAviso } from "@/app/api/_lib/casos-uso/recordatorios-whatsapp";
import { textoDelRecordatorio } from "@/lib/sms/texto";
import { ApiError } from "@/app/api/_lib/responses";
import { ACCIONES } from "@/lib/auditoria-acciones";
import { __resetLlaveroForTests } from "@/lib/llavero";
import type { EnviadorSms } from "@/lib/sms/twilio";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: sesionActual.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
// 12:00 de Montevideo del jueves 3/9/2026. El día de hoy en Montevideo va de
// 03:00Z del 3/9 a 02:59:59.999Z del 4/9.
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const INICIO_HOY = new Date("2026-09-03T03:00:00.000Z");
const FIN_HOY = new Date("2026-09-04T02:59:59.999Z");
const TELEFONO = "+59899123456";
const TEMPLATE = "Hola {{nombre}}. Te recordamos tu sesión:\n{{fecha}}  |  {{hora}}\n{{direccion}}";

type Org = { orgId: string; userId: string };

async function crearOrg(canal: CanalRecordatorio = "whatsapp"): Promise<Org> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await prismaRaw.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: "x", nombre: "Mariana", organizationId: org.id },
  });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      nombreProfesional: "Mariana Roldán",
      direccion: "Rivera 2540",
      whatsappOrigen: "+598 99 876 543",
      tarifaDefault: 1000,
      templateRecordatorio: TEMPLATE,
      canalRecordatorio: canal,
    },
  });
  return { orgId: org.id, userId: user.id };
}

async function crearPaciente(o: Org, telefono = TELEFONO, nombre = "Lucía") {
  return prismaRaw.paciente.create({
    data: { nombre, apellido: "Gómez", telefono, tarifa: 1000, organizationId: o.orgId },
  });
}

async function crearTurno(o: Org, pacienteId: string, fecha: Date, estado: "programado" | "cancelado" = "programado") {
  return prismaRaw.turno.create({
    data: { fecha, estado, tarifaCobrada: 1000, pacienteId, organizationId: o.orgId },
  });
}

/** El envío del turno, con el programadoEn que se le diga (como lo dejaría
 *  programarEnvioDelTurno, pero sin depender de su cuenta). */
async function crearEnvio(
  o: Org,
  turno: { id: string; fecha: Date; pacienteId: string },
  programadoEn: Date,
  extra: { motivo?: "recordatorio_turno" | "cambio_de_horario"; destino?: string; estado?: "pendiente" | "fallido" } = {},
) {
  const estado = extra.estado ?? "pendiente";
  return prismaRaw.envioSms.create({
    data: {
      organizationId: o.orgId,
      claveIdempotencia: claveDelTurno(turno.id, turno.fecha),
      motivo: extra.motivo ?? "recordatorio_turno",
      estado,
      pacienteId: turno.pacienteId,
      turnoId: turno.id,
      destino: extra.destino ?? TELEFONO,
      programadoEn,
      proximoIntentoEn: estado === "pendiente" ? programadoEn : null,
      // Creado al agendar, días antes: lo creado HOY con la hora ya vencida
      // es otro caso (ver "nació vencido").
      creadoEn: new Date(Math.min(programadoEn.getTime(), INICIO_HOY.getTime()) - 2 * DIA),
    },
  });
}

/** Un turno mañana a las 15:00 de Montevideo con su envío programado hoy. */
async function turnoConAvisoHoy(o: Org, opciones: { telefono?: string; nombre?: string; programadoEn?: Date } = {}) {
  const paciente = await crearPaciente(o, opciones.telefono ?? TELEFONO, opciones.nombre);
  const turno = await crearTurno(o, paciente.id, new Date("2026-09-04T18:00:00.000Z"));
  const envio = await crearEnvio(o, turno, opciones.programadoEn ?? new Date("2026-09-03T23:05:00.000Z"), {
    destino: paciente.telefono,
    estado: paciente.telefono ? "pendiente" : "fallido",
  });
  return { paciente, turno, envio };
}

const textoDelEnlace = (enlace: string) => new URL(enlace).searchParams.get("text");

function enviadorDoble() {
  const textos: string[] = [];
  const enviar: EnviadorSms = vi.fn(async ({ texto }) => {
    textos.push(texto);
    return { tipo: "aceptado", sid: `SM${randomUUID().replaceAll("-", "")}`, segmentos: 1, estadoTwilio: "queued" } as const;
  });
  return { enviar, textos };
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
  sesionActual.userId = "";
});

afterAll(async () => {
  vi.useRealTimers();
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

// ─── Listar ─────────────────────────────────────────────────────────────────

/** Que abrió el enlace del turno, avisando `fechaTurno`, en `abiertoEn`. */
async function avisar(o: Org, turnoId: string, fechaTurno: Date, abiertoEn: Date) {
  return prismaRaw.avisoWhatsapp.create({
    data: { organizationId: o.orgId, turnoId, tipo: "recordatorio", fechaTurno, abiertoEn, usuarioId: o.userId },
  });
}

const listar = (o: Org, ahora = AHORA) => listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora });
const MANANA_15 = new Date("2026-09-04T18:00:00.000Z");

describe("listarRecordatoriosDeHoy: sale de los turnos, no de envios_sms", () => {
  it("el turno de mañana (modo de siempre: la tarde anterior) entra con su enlace, sin ninguna fila de envios_sms", async () => {
    const o = await crearOrg();
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, MANANA_15);
    expect(await prismaRaw.envioSms.count()).toBe(0);

    const { turnos } = await listar(o);
    expect(turnos).toHaveLength(1);
    expect(turnos[0]).toMatchObject({ turnoId: turno.id, fecha: MANANA_15.toISOString(), motivo: null, avisadoEn: null });
    expect(turnos[0].enlace).toMatch(/^https:\/\/wa\.me\/59899123456\?text=/);
    expect(textoDelEnlace(turnos[0].enlace!)).toContain("Hola Lucía. Te recordamos tu sesión:");
  });

  it("la regla: entra si su momento de aviso ya llegó hoy o antes; pasado mañana todavía no", async () => {
    const o = await crearOrg();
    const p = await crearPaciente(o);
    // Hoy a las 18:00: su aviso era ayer a las 20:00 y no se mandó.
    const hoyTarde = await crearTurno(o, p.id, new Date("2026-09-03T21:00:00.000Z"));
    const manana = await crearTurno(o, p.id, MANANA_15);
    await crearTurno(o, p.id, new Date("2026-09-05T18:00:00.000Z"));
    expect((await listar(o)).turnos.map((t) => t.turnoId)).toEqual([hoyTarde.id, manana.id]);
  });

  it("sigue el modo de Tu consultorio", async () => {
    const o = await crearOrg();
    await prismaRaw.configuracion.update({ where: { organizationId: o.orgId }, data: { recordatorioModo: "dos_dias_antes" } });
    const p = await crearPaciente(o);
    const pasado = await crearTurno(o, p.id, new Date("2026-09-05T18:00:00.000Z"));
    await crearTurno(o, p.id, new Date("2026-09-06T18:00:00.000Z"));
    expect((await listar(o)).turnos.map((t) => t.turnoId)).toContain(pasado.id);
    expect((await listar(o)).turnos).toHaveLength(1);
  });

  it("avisado hoy sigue en la lista, marcado; avisado otro día para su fecha, ya no", async () => {
    const o = await crearOrg();
    const p = await crearPaciente(o);
    const hoy = await crearTurno(o, p.id, MANANA_15);
    const ayer = await crearTurno(o, p.id, new Date("2026-09-04T20:00:00.000Z"));
    await avisar(o, hoy.id, hoy.fecha, new Date("2026-09-03T13:00:00.000Z"));
    await avisar(o, ayer.id, ayer.fecha, new Date("2026-09-02T23:00:00.000Z"));
    const { turnos } = await listar(o);
    expect(turnos.map((t) => [t.turnoId, t.avisadoEn])).toEqual([[hoy.id, "2026-09-03T13:00:00.000Z"]]);
  });

  it("movido después de avisar: entra ya con el texto de cambio de horario, aunque falten días", async () => {
    const o = await crearOrg();
    const p = await crearPaciente(o);
    const lejos = new Date("2026-09-10T18:00:00.000Z");
    const turno = await crearTurno(o, p.id, lejos);
    await avisar(o, turno.id, new Date("2026-09-04T18:00:00.000Z"), new Date("2026-09-02T23:00:00.000Z"));
    const { turnos } = await listar(o);
    expect(turnos.map((t) => t.turnoId)).toEqual([turno.id]);
    expect(textoDelEnlace(turnos[0].enlace!)).toBe(
      textoDelRecordatorio("cambio_de_horario", await configDe(o), p, lejos),
    );
  });

  it("deja afuera el turno cerrado, el que ya empezó, la paciente archivada y otra organización", async () => {
    const o = await crearOrg();
    const otra = await crearOrg();
    const p = await crearPaciente(o);
    const archivada = await prismaRaw.paciente.create({
      data: { nombre: "Archi", apellido: "Vada", telefono: TELEFONO, tarifa: 1000, organizationId: o.orgId, activo: false },
    });
    const queda = await crearTurno(o, p.id, MANANA_15);
    await crearTurno(o, p.id, new Date("2026-09-04T19:00:00.000Z"), "cancelado");
    await crearTurno(o, p.id, new Date("2026-09-03T14:00:00.000Z"));
    await crearTurno(o, archivada.id, MANANA_15);
    await crearTurno(otra, (await crearPaciente(otra)).id, MANANA_15);
    expect((await listar(o)).turnos.map((t) => t.turnoId)).toEqual([queda.id]);
  });

  it("sin teléfono: enlace null y motivo sin_telefono", async () => {
    const o = await crearOrg();
    const p = await crearPaciente(o, "");
    await crearTurno(o, p.id, MANANA_15);
    expect((await listar(o)).turnos[0]).toMatchObject({ enlace: null, motivo: "sin_telefono" });
  });

  it("ordena por la hora del turno", async () => {
    const o = await crearOrg();
    const p = await crearPaciente(o);
    const tarde = await crearTurno(o, p.id, new Date("2026-09-04T21:00:00.000Z"));
    const temprano = await crearTurno(o, p.id, new Date("2026-09-04T12:00:00.000Z"));
    expect((await listar(o)).turnos.map((t) => t.turnoId)).toEqual([temprano.id, tarde.id]);
  });
});

describe("correspondeAvisarHoy (la regla, en memoria)", () => {
  const hoy = AHORA;
  it("momento llegado y sin aviso: sí; momento futuro: no", () => {
    expect(correspondeAvisarHoy({ fecha: MANANA_15, avisos: [] }, "dia_anterior", hoy)).toEqual({ motivo: "recordatorio_turno", avisadoEn: null });
    expect(correspondeAvisarHoy({ fecha: new Date("2026-09-05T18:00:00.000Z"), avisos: [] }, "dia_anterior", hoy)).toBeNull();
  });
  it("con un aviso de otra fecha es cambio de horario, sea cuando sea el turno", () => {
    const fecha = new Date("2026-10-01T18:00:00.000Z");
    expect(correspondeAvisarHoy({ fecha, avisos: [{ fechaTurno: MANANA_15, abiertoEn: INICIO_HOY }] }, "dia_anterior", hoy))
      .toEqual({ motivo: "cambio_de_horario", avisadoEn: null });
  });
  it("avisado para su fecha antes de hoy: no; hoy: sí, con la última apertura", () => {
    const ayer = new Date(INICIO_HOY.getTime() - HORA);
    expect(correspondeAvisarHoy({ fecha: MANANA_15, avisos: [{ fechaTurno: MANANA_15, abiertoEn: ayer }] }, "dia_anterior", hoy)).toBeNull();
    const abierto = new Date(INICIO_HOY.getTime() + HORA);
    expect(correspondeAvisarHoy({ fecha: MANANA_15, avisos: [{ fechaTurno: MANANA_15, abiertoEn: ayer }, { fechaTurno: MANANA_15, abiertoEn: abierto }] }, "dia_anterior", hoy))
      .toEqual({ motivo: "recordatorio_turno", avisadoEn: abierto });
  });
  it("FIN_HOY es el borde: un aviso que cae justo después es de mañana", () => {
    // Turno pasado mañana a las 00:30 de Montevideo: su aviso es mañana a las 20:00.
    expect(correspondeAvisarHoy({ fecha: new Date(FIN_HOY.getTime() + DIA + 22 * MIN), avisos: [] }, "dia_anterior", hoy)).toBeNull();
  });
});

async function configDe(o: Org) {
  return (await prismaRaw.configuracion.findUniqueOrThrow({
    where: { organizationId: o.orgId },
    select: { templateRecordatorio: true, direccion: true, nombreProfesional: true, whatsappOrigen: true },
  }));
}

// ─── El cron ────────────────────────────────────────────────────────────────

describe("despacharEnvios según el canal", () => {
  it("whatsapp: cancela el recordatorio con su motivo y no llama a Twilio", async () => {
    const o = await crearOrg("whatsapp");
    const { envio } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() - MIN) });
    const { enviar } = enviadorDoble();

    const r = await despacharEnvios({ prisma: db, ahora: AHORA, enviar });

    expect(enviar).not.toHaveBeenCalled();
    expect(r.cancelados).toBe(1);
    const fila = await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } });
    expect(fila).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_CANAL_WHATSAPP, intentos: 0, sid: null });
    expect(fila.cerradoEn).toEqual(AHORA);
    expect(r.eventos.some((e) => e.startsWith("[sms][canal-whatsapp]"))).toBe(true);
  });

  it("whatsapp: lo que todavía no venció no se toca", async () => {
    const o = await crearOrg("whatsapp");
    const { envio } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() + HORA) });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar });

    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe("pendiente");
  });

  // Sólo WhatsApp (CANAL_RECORDATORIO_VIGENTE): lo guardado no cuenta.
  it.each(["ambos", "sms"] as const)("%s guardado: cancela igual, con el motivo del canal", async (canal) => {
    const o = await crearOrg(canal);
    const { envio } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() - MIN) });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar });

    expect(enviar).not.toHaveBeenCalled();
    expect(await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).toMatchObject({
      estado: "cancelado",
      motivoNoEnvio: MOTIVO_CANAL_WHATSAPP,
    });
  });

  it.each(["ambos", "sms"] as const)("%s con el canal guardado (el SMS hasta borrarlo): manda como siempre", async (canal) => {
    const o = await crearOrg(canal);
    const { envio } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() - MIN) });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar, canalDe: (guardado) => guardado ?? "sms" });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe("aceptado");
  });

  it("whatsapp: el aviso de cobro (lo pidió ella) sigue saliendo por SMS", async () => {
    const o = await crearOrg("whatsapp");
    const paciente = await crearPaciente(o);
    const envio = await prismaRaw.envioSms.create({
      data: {
        organizationId: o.orgId,
        claveIdempotencia: `cobro:${paciente.id}:2026-09-03`,
        motivo: "recordatorio_cobro",
        pacienteId: paciente.id,
        destino: TELEFONO,
        programadoEn: AHORA,
        proximoIntentoEn: AHORA,
      },
    });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar, textoDeCobro: async () => "Debés 1 sesión" });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe("aceptado");
  });

  it("decide al despachar: lo agendado con sms guardado se cancela igual", async () => {
    const o = await crearOrg("sms");
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, new Date("2026-09-04T18:00:00.000Z"));
    await programarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: turno.fecha,
      ahora: AHORA,
    });
    await prismaRaw.configuracion.update({ where: { organizationId: o.orgId }, data: { canalRecordatorio: "whatsapp" } });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: new Date(turno.fecha.getTime() - 3 * HORA), enviar });

    expect(enviar).not.toHaveBeenCalled();
    const [fila] = await prismaRaw.envioSms.findMany({ where: { turnoId: turno.id } });
    expect(fila).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_CANAL_WHATSAPP });
  });

  it("whatsapp con el turno ya cerrado: el motivo es el del turno, no el del canal", async () => {
    const o = await crearOrg("whatsapp");
    const { envio, turno } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() - MIN) });
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { estado: "cancelado" } });

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar: enviadorDoble().enviar });

    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).motivoNoEnvio).not.toBe(
      MOTIVO_CANAL_WHATSAPP,
    );
  });
});

// ─── Registrar la apertura ──────────────────────────────────────────────────

describe("registrarAviso", () => {
  it("crea la fila y el evento de auditoría; repetir crea otra", async () => {
    const o = await crearOrg();
    const { turno } = await turnoConAvisoHoy(o);

    const a = await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: AHORA });
    const despues = new Date(AHORA.getTime() + MIN);
    const b = await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: despues });

    expect(a).toEqual({ avisadoEn: AHORA.toISOString() });
    expect(b).toEqual({ avisadoEn: despues.toISOString() });
    const filas = await prismaRaw.avisoWhatsapp.findMany({ where: { turnoId: turno.id }, orderBy: { abiertoEn: "asc" } });
    expect(filas).toMatchObject([
      { organizationId: o.orgId, tipo: "recordatorio", fechaTurno: turno.fecha, abiertoEn: AHORA, usuarioId: o.userId },
      { abiertoEn: despues },
    ]);
    const eventos = await prismaRaw.eventoAuditoria.findMany({ where: { organizationId: o.orgId } });
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({
      accion: ACCIONES.recordatorio.whatsappAbierto,
      actorTipo: "usuario",
      actorId: o.userId,
      entidad: "turno",
      entidadId: turno.id,
    });
  });

  it("con la fecha del enlace que abrió: si el turno se movió entre el GET y el toque, la apertura es de la fecha vieja", async () => {
    const o = await crearOrg();
    const { turno } = await turnoConAvisoHoy(o);
    const [delGet] = (await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos;
    const nueva = new Date(turno.fecha.getTime() + DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });

    await registrarAviso({
      prisma: db,
      organizationId: o.orgId,
      turnoId: turno.id,
      usuarioId: o.userId,
      ahora: AHORA,
      fechaTurno: new Date(delGet.fecha),
    });

    const fila = await prismaRaw.avisoWhatsapp.findFirstOrThrow({ where: { turnoId: turno.id } });
    expect(fila.fechaTurno).toEqual(turno.fecha);
  });

  it("abrió un enlace viejo después de que el turno se movió: la lista lo vuelve a pedir, como cambio de horario", async () => {
    const o = await crearOrg();
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, MANANA_15);
    const [delGet] = (await listar(o)).turnos;
    // Lo mueve una semana antes de que llegue la apertura.
    const nueva = new Date(turno.fecha.getTime() + 7 * DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    const despues = new Date(AHORA.getTime() + MIN);
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: despues, fechaTurno: new Date(delGet.fecha) });

    const r = await listar(o, despues);
    expect(r.turnos).toHaveLength(1);
    expect(r.turnos[0]).toMatchObject({ fecha: nueva.toISOString(), avisadoEn: null });
    expect(textoDelEnlace(r.turnos[0].enlace!)).toBe(textoDelRecordatorio("cambio_de_horario", await configDe(o), paciente, nueva));
  });

  it("404 si el turno es de otra organización, sin escribir nada", async () => {
    const o = await crearOrg();
    const ajena = await crearOrg();
    const { turno } = await turnoConAvisoHoy(ajena);

    const error = await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: AHORA }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect(await prismaRaw.avisoWhatsapp.count()).toBe(0);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });
});

// ─── Rutas ──────────────────────────────────────────────────────────────────

describe("rutas", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  async function entrar(canal: CanalRecordatorio = "whatsapp") {
    const o = await crearOrg(canal);
    sesionActual.organizationId = o.orgId;
    sesionActual.userId = o.userId;
    return o;
  }

  it("GET /api/recordatorios/whatsapp: el contrato exacto", async () => {
    const o = await entrar();
    const { turno, paciente } = await turnoConAvisoHoy(o);
    await turnoConAvisoHoy(o, { telefono: "", nombre: "Sin" });
    const { GET } = await import("@/app/api/recordatorios/whatsapp/route");

    const res = await GET();

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual({
      data: {
        canal: "whatsapp",
        turnos: [
          {
            turnoId: turno.id,
            fecha: turno.fecha.toISOString(),
            paciente: { id: paciente.id, nombre: "Lucía", apellido: "Gómez", telefono: TELEFONO },
            enlace: expect.stringMatching(/^https:\/\/wa\.me\/59899123456\?text=/),
            motivo: null,
            avisadoEn: null,
          },
          {
            turnoId: expect.any(String),
            fecha: expect.any(String),
            paciente: { id: expect.any(String), nombre: "Sin", apellido: "Gómez", telefono: "" },
            enlace: null,
            motivo: "sin_telefono",
            avisadoEn: null,
          },
        ],
      },
    });
  });

  it("GET con sms guardado: canal whatsapp y la lista llena", async () => {
    const o = await entrar("sms");
    await turnoConAvisoHoy(o);
    const { GET } = await import("@/app/api/recordatorios/whatsapp/route");

    const { data } = await (await GET()).json();
    expect(data.canal).toBe("whatsapp");
    expect(data.turnos).toHaveLength(1);
  });

  it("POST …/[turnoId]/abierto: 201 con avisadoEn, y el GET lo refleja", async () => {
    const o = await entrar();
    const { turno } = await turnoConAvisoHoy(o);
    const { POST } = await import("@/app/api/recordatorios/whatsapp/[turnoId]/abierto/route");
    const { GET } = await import("@/app/api/recordatorios/whatsapp/route");

    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ turnoId: turno.id }) });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { avisadoEn: AHORA.toISOString() } });
    const lista = await (await GET()).json();
    expect(lista.data.turnos[0].avisadoEn).toBe(AHORA.toISOString());
  });

  it("POST con { fecha } la registra; una fecha que no es ISO es 400", async () => {
    const o = await entrar();
    const { turno } = await turnoConAvisoHoy(o);
    const { POST } = await import("@/app/api/recordatorios/whatsapp/[turnoId]/abierto/route");
    const postJson = (body: unknown) =>
      POST(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
        params: Promise.resolve({ turnoId: turno.id }),
      });
    const vieja = new Date(turno.fecha.getTime() - DIA);

    expect((await postJson({ fecha: vieja.toISOString() })).status).toBe(201);
    expect((await postJson({})).status).toBe(201);
    expect((await postJson({ fecha: "ayer" })).status).toBe(400);

    const filas = await prismaRaw.avisoWhatsapp.findMany({ where: { turnoId: turno.id }, orderBy: { fechaTurno: "asc" } });
    expect(filas.map((f) => f.fechaTurno)).toEqual([vieja, turno.fecha]);
  });

  it("GET …/[turnoId]: el aviso del turno para su fecha vigente (pendiente o avisado), 404 si es ajeno", async () => {
    const o = await crearOrg();
    const ajena = await crearOrg();
    const p = await crearPaciente(o);
    const turno = await crearTurno(o, p.id, MANANA_15);
    const { GET } = await import("@/app/api/recordatorios/whatsapp/[turnoId]/route");
    const pedir = () => GET(new Request("http://localhost/x"), { params: Promise.resolve({ turnoId: turno.id }) });
    sesionActual.organizationId = o.orgId;
    sesionActual.userId = o.userId;
    expect(await (await pedir()).json()).toEqual({ data: { avisadoEn: null } });
    // Lo avisado para otra fecha no cuenta: el turno se movió después.
    await avisar(o, turno.id, new Date(MANANA_15.getTime() - DIA), new Date("2026-09-01T12:00:00.000Z"));
    await avisar(o, turno.id, MANANA_15, new Date("2026-09-02T12:00:00.000Z"));
    await avisar(o, turno.id, MANANA_15, new Date("2026-09-03T12:00:00.000Z"));
    expect(await (await pedir()).json()).toEqual({ data: { avisadoEn: "2026-09-03T12:00:00.000Z" } });
    sesionActual.organizationId = ajena.orgId;
    expect((await pedir()).status).toBe(404);
  });

  it("POST con un turno ajeno o inexistente: 404", async () => {
    await entrar();
    const { turno } = await turnoConAvisoHoy(await crearOrg());
    const { POST } = await import("@/app/api/recordatorios/whatsapp/[turnoId]/abierto/route");

    for (const turnoId of [turno.id, randomUUID()]) {
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ turnoId }) });
      expect(res.status).toBe(404);
    }
    expect(await prismaRaw.avisoWhatsapp.count()).toBe(0);
  });

  it.each(["sms", "ambos"] as const)("/api/config: con %s guardado devuelve whatsapp, y por PATCH sólo acepta whatsapp", async (guardado) => {
    const o = await entrar(guardado);
    const { GET, PATCH } = await import("@/app/api/config/route");
    const patch = (body: unknown) =>
      PATCH(new Request("http://localhost/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const guardadoEnLaBase = async () =>
      (await prismaRaw.configuracion.findUniqueOrThrow({ where: { organizationId: o.orgId } })).canalRecordatorio;

    expect((await (await GET()).json()).data.canalRecordatorio).toBe("whatsapp");
    for (const canal of ["sms", "ambos", "paloma"]) expect((await patch({ canalRecordatorio: canal })).status).toBe(400);
    expect(await guardadoEnLaBase()).toBe(guardado);
    const res = await patch({ canalRecordatorio: "whatsapp" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.canalRecordatorio).toBe("whatsapp");
    expect(await guardadoEnLaBase()).toBe("whatsapp");
  });

  it("una configuración creada sin canal queda en sms", async () => {
    const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
    const c = await prismaRaw.configuracion.create({
      data: { organizationId: org.id, nombreProfesional: "X", tarifaDefault: 1 },
    });
    expect(c.canalRecordatorio).toBe("sms");
  });
});

describe("auditoría de Tu consultorio (configuracion.editar)", () => {
  async function entrar(canal: CanalRecordatorio) {
    const o = await crearOrg(canal);
    sesionActual.organizationId = o.orgId;
    sesionActual.userId = o.userId;
    return o;
  }
  const patch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/config/route");
    return PATCH(new Request("http://localhost/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  };
  const eventos = (organizationId: string) =>
    prismaRaw.eventoAuditoria.findMany({ where: { organizationId, accion: ACCIONES.configuracion.editar }, orderBy: { creadoEn: "asc" } });

  it("deja quién cambió qué: el canal y el modo con su antes y después, las plantillas sólo por nombre", async () => {
    const o = await entrar("sms");
    const cobro = "Hola {{nombre}}, quedan {{monto}} sin pagar.";
    const res = await patch({ canalRecordatorio: "whatsapp", recordatorioModo: "misma_manana", templateCobro: cobro, templateRecordatorio: TEMPLATE });
    expect(res.status).toBe(200);
    const [evento, ...otros] = await eventos(o.orgId);
    expect(otros).toHaveLength(0);
    const config = await prismaRaw.configuracion.findUniqueOrThrow({ where: { organizationId: o.orgId } });
    expect(evento).toMatchObject({
      actorTipo: "usuario",
      actorId: o.userId,
      entidad: "configuracion",
      entidadId: config.id,
      // templateRecordatorio llegó igual al guardado: no cambió.
      detalle: {
        campos: ["canalRecordatorio", "recordatorioModo", "templateCobro"],
        canalRecordatorioAntes: "sms",
        canalRecordatorioDespues: "whatsapp",
        recordatorioModoAntes: "dia_anterior",
        recordatorioModoDespues: "misma_manana",
      },
    });
    expect(JSON.stringify(evento.detalle)).not.toContain("quedan");
  });

  it("guardar lo mismo (el autoguardado lo hace) no deja evento", async () => {
    const o = await entrar("whatsapp");
    expect((await patch({ canalRecordatorio: "whatsapp", templateRecordatorio: TEMPLATE })).status).toBe(200);
    expect(await eventos(o.orgId)).toHaveLength(0);
  });

  it("cada organización ve sólo sus cambios", async () => {
    const otra = await crearOrg("sms");
    const o = await entrar("sms");
    await patch({ canalRecordatorio: "whatsapp" });
    expect(await eventos(o.orgId)).toHaveLength(1);
    expect(await eventos(otra.orgId)).toHaveLength(0);
    expect((await prismaRaw.configuracion.findUniqueOrThrow({ where: { organizationId: otra.orgId } })).canalRecordatorio).toBe("sms");
  });
});

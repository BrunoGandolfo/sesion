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

import { despacharEnvios, MOTIVO_BAJA } from "@/app/api/_lib/casos-uso/despachar-sms";
import {
  claveDelTurno,
  MOTIVO_CANAL_WHATSAPP,
  programarEnvioDelTurno,
  reprogramarEnvioDelTurno,
} from "@/app/api/_lib/casos-uso/envios-del-turno";
import { listarRecordatoriosDeHoy, registrarAviso } from "@/app/api/_lib/casos-uso/recordatorios-whatsapp";
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

describe("listarRecordatoriosDeHoy", () => {
  it("devuelve el turno con su enlace al teléfono y el texto de la plantilla", async () => {
    const o = await crearOrg();
    const { turno, paciente } = await turnoConAvisoHoy(o);

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });

    expect(r.canal).toBe("whatsapp");
    expect(r.turnos).toEqual([
      {
        turnoId: turno.id,
        fecha: turno.fecha.toISOString(),
        paciente: { id: paciente.id, nombre: "Lucía", apellido: "Gómez", telefono: TELEFONO },
        enlace: expect.stringMatching(/^https:\/\/wa\.me\/59899123456\?text=/),
        motivo: null,
        avisadoEn: null,
      },
    ]);
    const texto = textoDelEnlace(r.turnos[0].enlace!);
    expect(texto).toContain("Hola Lucía.");
    expect(texto).toContain("Rivera 2540");
  });

  it("la fuente es programado_en: entra lo programado hoy, sea cual sea la fecha del turno, y nada más", async () => {
    const o = await crearOrg();
    // Turno dentro de 3 días con el envío programado HOY: recalcular con
    // dia_anterior diría "pasado mañana"; programado_en manda.
    const pLejos = await crearPaciente(o, TELEFONO, "Lejos");
    const lejos = await crearTurno(o, pLejos.id, new Date(AHORA.getTime() + 3 * DIA));
    await crearEnvio(o, lejos, INICIO_HOY);
    // Turno mañana con el envío programado MAÑANA (misma_manana): recalcular
    // con dia_anterior diría "hoy"; no entra.
    const pManana = await crearPaciente(o, TELEFONO, "Mañana");
    const manana = await crearTurno(o, pManana.id, new Date("2026-09-04T18:00:00.000Z"));
    await crearEnvio(o, manana, new Date("2026-09-04T11:00:00.000Z"));
    // Programado ayer y tratado ayer por el cron (con canal whatsapp, lo
    // canceló): fue el aviso de ayer.
    const pAyer = await crearPaciente(o, TELEFONO, "Ayer");
    const ayer = await crearTurno(o, pAyer.id, new Date(AHORA.getTime() + 5 * HORA));
    const envioAyer = await crearEnvio(o, ayer, new Date(INICIO_HOY.getTime() - HORA));
    await prismaRaw.envioSms.update({
      where: { id: envioAyer.id },
      data: { estado: "cancelado", motivoNoEnvio: MOTIVO_CANAL_WHATSAPP, cerradoEn: new Date(INICIO_HOY.getTime() - 50 * MIN), proximoIntentoEn: null },
    });
    // El último milisegundo de hoy en Montevideo sí cuenta.
    const pBorde = await crearPaciente(o, TELEFONO, "Borde");
    const borde = await crearTurno(o, pBorde.id, new Date(AHORA.getTime() + 2 * DIA));
    await crearEnvio(o, borde, FIN_HOY);

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });

    expect(r.turnos.map((t) => t.paciente.nombre).sort()).toEqual(["Borde", "Lejos"]);
  });

  it("cuenta lo que programarEnvioDelTurno deja para mañana con el modo de siempre", async () => {
    const o = await crearOrg();
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, new Date("2026-09-04T18:00:00.000Z"));
    await programarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: turno.fecha,
      ahora: AHORA,
    });

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos.map((t) => t.turnoId)).toEqual([turno.id]);
  });

  it("nació vencido: agendado hoy para esta tarde entra hoy, aunque su programado_en sea de ayer", async () => {
    const o = await crearOrg();
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, new Date(AHORA.getTime() + 6 * HORA));
    await programarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: turno.fecha,
      ahora: AHORA,
    });
    // La base pone creado_en con su reloj: se fija en "hoy" del test.
    await prismaRaw.envioSms.updateMany({ where: { turnoId: turno.id }, data: { creadoEn: AHORA } });
    const envio = await prismaRaw.envioSms.findFirstOrThrow({ where: { turnoId: turno.id } });
    expect(envio.programadoEn.getTime()).toBeLessThan(INICIO_HOY.getTime());

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos.map((t) => t.turnoId)).toEqual([turno.id]);
    // El cron lo trata en el tick siguiente (lo cancela: canal whatsapp) y
    // sigue en la lista de hoy.
    await despacharEnvios({ prisma: db, ahora: AHORA, enviar: enviadorDoble().enviar });
    expect((await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos).toHaveLength(1);
    // Mañana ya no: fue el aviso de hoy.
    const manana = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: new Date(AHORA.getTime() + DIA) });
    expect(manana.turnos).toEqual([]);
  });

  it("reabierto hoy: el envío que revive con su hora vencida entra hoy", async () => {
    const o = await crearOrg();
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, new Date(AHORA.getTime() + 6 * HORA));
    // Su aviso era de ayer y se apagó al marcarlo ausente.
    const envio = await crearEnvio(o, turno, new Date(INICIO_HOY.getTime() - 4 * HORA));
    await prismaRaw.envioSms.update({
      where: { id: envio.id },
      data: { estado: "cancelado", cerradoEn: new Date(INICIO_HOY.getTime() - 5 * HORA), proximoIntentoEn: null },
    });
    expect((await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos).toEqual([]);

    // Lo vuelve a programado hoy: programarEnvioDelTurno revive la fila.
    await programarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: turno.fecha,
      ahora: AHORA,
    });
    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe("pendiente");

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos.map((t) => t.turnoId)).toEqual([turno.id]);
  });

  it("un turno movido no aparece por su envío viejo, y sí con el cambio de horario de hoy", async () => {
    const o = await crearOrg();
    const { turno, paciente } = await turnoConAvisoHoy(o);
    // Se mueve a la semana que viene: el envío de hoy queda cancelado con la
    // fecha vieja y el nuevo se programa para otro día.
    const nueva = new Date(turno.fecha.getTime() + 7 * DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: turno.fecha,
      ahora: AHORA,
    });
    expect((await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos).toEqual([]);

    // Si el aviso viejo ya había salido, el nuevo es un cambio de horario que
    // sale hoy: ese sí se prepara, con su propio texto.
    await prismaRaw.envioSms.updateMany({
      where: { claveIdempotencia: claveDelTurno(turno.id, turno.fecha) },
      data: { estado: "aceptado", aceptadoEn: AHORA },
    });
    const otra = new Date(nueva.getTime() + DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: otra } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: otra,
      fechaTurnoPrevia: nueva,
      ahora: AHORA,
    });
    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos).toHaveLength(1);
    expect(r.turnos[0].fecha).toBe(otra.toISOString());
    expect(textoDelEnlace(r.turnos[0].enlace!)).not.toContain("Te recordamos");
  });

  it("abrió el WhatsApp y después movió el turno: sale ya un cambio de horario, pendiente de avisar, sin que haya salido ningún SMS", async () => {
    const o = await crearOrg();
    const { turno, paciente } = await turnoConAvisoHoy(o);
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: AHORA });
    expect(await prismaRaw.envioSms.count({ where: { aceptadoEn: { not: null } } })).toBe(0);

    const nueva = new Date(turno.fecha.getTime() + 7 * DIA);
    const despues = new Date(AHORA.getTime() + 10 * MIN);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: turno.fecha,
      ahora: despues,
    });

    const nuevo = await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: claveDelTurno(turno.id, nueva) } });
    expect(nuevo).toMatchObject({ motivo: "cambio_de_horario", programadoEn: despues });
    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: despues });
    expect(r.turnos).toHaveLength(1);
    expect(r.turnos[0]).toMatchObject({ fecha: nueva.toISOString(), avisadoEn: null });
    expect(textoDelEnlace(r.turnos[0].enlace!)).not.toContain("Te recordamos");
  });

  it("abrir de nuevo con la misma fecha no lo convierte en cambio de horario", async () => {
    const o = await crearOrg();
    const { turno, paciente } = await turnoConAvisoHoy(o);
    // Un turno sin abrir, movido: el de siempre, a su hora.
    const nueva = new Date(turno.fecha.getTime() + 7 * DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: turno.fecha,
      ahora: AHORA,
    });
    // Abre el de la fecha nueva y lo vuelve a mover a esa misma fecha (no-op).
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: AHORA });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: nueva,
      ahora: AHORA,
    });

    const nuevo = await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: claveDelTurno(turno.id, nueva) } });
    expect(nuevo.motivo).toBe("recordatorio_turno");
  });

  it("deja afuera el turno cerrado, el que ya empezó, la paciente archivada, la baja y otra organización", async () => {
    const o = await crearOrg();
    const cerrado = await turnoConAvisoHoy(o, { nombre: "Cerrado" });
    await prismaRaw.turno.update({ where: { id: cerrado.turno.id }, data: { estado: "cancelado" } });
    const empezado = await crearPaciente(o, TELEFONO, "Empezado");
    const tEmpezado = await crearTurno(o, empezado.id, new Date(AHORA.getTime() - MIN));
    await crearEnvio(o, tEmpezado, INICIO_HOY);
    const archivada = await turnoConAvisoHoy(o, { nombre: "Archivada" });
    await prismaRaw.paciente.update({ where: { id: archivada.paciente.id }, data: { activo: false } });
    await turnoConAvisoHoy(o, { nombre: "Baja", telefono: "+59899000111" });
    await prismaRaw.bajaSms.create({ data: { telefono: "+59899000111", motivo: "respuesta_baja" } });
    await turnoConAvisoHoy(await crearOrg(), { nombre: "Ajena" });
    await turnoConAvisoHoy(o, { nombre: "Queda" });

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos.map((t) => t.paciente.nombre)).toEqual(["Queda"]);
  });

  it("sin teléfono: enlace null y motivo sin_telefono", async () => {
    const o = await crearOrg();
    await turnoConAvisoHoy(o, { telefono: "" });

    const [t] = (await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos;
    expect(t.enlace).toBeNull();
    expect(t.motivo).toBe("sin_telefono");
  });

  it("con canal sms la lista viene vacía aunque haya avisos hoy; con ambos, llena", async () => {
    const sms = await crearOrg("sms");
    await turnoConAvisoHoy(sms);
    expect(await listarRecordatoriosDeHoy({ prisma: db, organizationId: sms.orgId, ahora: AHORA })).toEqual({
      canal: "sms",
      turnos: [],
    });
    const ambos = await crearOrg("ambos");
    await turnoConAvisoHoy(ambos);
    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: ambos.orgId, ahora: AHORA });
    expect(r.canal).toBe("ambos");
    expect(r.turnos).toHaveLength(1);
  });

  it("ordena por la hora del turno y trae la última apertura", async () => {
    const o = await crearOrg();
    const tarde = await turnoConAvisoHoy(o, { nombre: "Tarde" });
    await prismaRaw.turno.update({ where: { id: tarde.turno.id }, data: { fecha: new Date("2026-09-04T21:00:00.000Z") } });
    await prismaRaw.envioSms.update({
      where: { id: tarde.envio.id },
      data: { claveIdempotencia: claveDelTurno(tarde.turno.id, new Date("2026-09-04T21:00:00.000Z")), programadoEn: INICIO_HOY },
    });
    const temprano = await turnoConAvisoHoy(o, { nombre: "Temprano" });
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: temprano.turno.id, usuarioId: o.userId, ahora: new Date(AHORA.getTime() - HORA) });
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: temprano.turno.id, usuarioId: o.userId, ahora: AHORA });

    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA });
    expect(r.turnos.map((t) => [t.paciente.nombre, t.avisadoEn])).toEqual([
      ["Temprano", AHORA.toISOString()],
      ["Tarde", null],
    ]);
  });
});

// ─── El mismo texto que el SMS ──────────────────────────────────────────────

describe("el texto del WhatsApp y el del SMS", () => {
  it.each(["recordatorio_turno", "cambio_de_horario"] as const)("son el mismo (%s)", async (motivo) => {
    const o = await crearOrg("ambos");
    const paciente = await crearPaciente(o);
    const turno = await crearTurno(o, paciente.id, new Date("2026-09-04T18:00:00.000Z"));
    await crearEnvio(o, turno, new Date(AHORA.getTime() - MIN), { motivo });

    const [t] = (await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos;
    const { enviar, textos } = enviadorDoble();
    await despacharEnvios({ prisma: db, ahora: AHORA, enviar });

    expect(textos).toHaveLength(1);
    expect(textoDelEnlace(t.enlace!)).toBe(textos[0]);
  });
});

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

  it.each(["ambos", "sms"] as const)("%s: manda como siempre", async (canal) => {
    const o = await crearOrg(canal);
    const { envio } = await turnoConAvisoHoy(o, { programadoEn: new Date(AHORA.getTime() - MIN) });
    const { enviar } = enviadorDoble();

    await despacharEnvios({ prisma: db, ahora: AHORA, enviar });

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

  it("decide al despachar: pasar a whatsapp después de agendar cancela lo ya programado", async () => {
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

  it("abrió un enlace viejo después de que el turno se movió: el recordatorio vigente pasa a cambio de horario y sale ya", async () => {
    const o = await crearOrg();
    const { turno, paciente } = await turnoConAvisoHoy(o);
    const [delGet] = (await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: AHORA })).turnos;
    // Lo mueve ANTES de que llegue la apertura: reprogramar no ve aviso y
    // deja un recordatorio común para la fecha nueva.
    const nueva = new Date(turno.fecha.getTime() + 7 * DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: turno.fecha,
      ahora: AHORA,
    });
    const clave = claveDelTurno(turno.id, nueva);
    expect((await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: clave } })).motivo).toBe("recordatorio_turno");

    const despues = new Date(AHORA.getTime() + MIN);
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: despues, fechaTurno: new Date(delGet.fecha) });

    expect(await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: clave } })).toMatchObject({
      motivo: "cambio_de_horario",
      estado: "pendiente",
      programadoEn: despues,
      proximoIntentoEn: despues,
    });
    const r = await listarRecordatoriosDeHoy({ prisma: db, organizationId: o.orgId, ahora: despues });
    expect(r.turnos).toHaveLength(1);
    expect(r.turnos[0]).toMatchObject({ fecha: nueva.toISOString(), avisadoEn: null });
  });

  it("enlace viejo con el recordatorio vigente ya cancelado por el canal: se corrige igual; uno apagado por otra causa, no", async () => {
    const o = await crearOrg("whatsapp");
    const { turno, paciente } = await turnoConAvisoHoy(o);
    const vieja = turno.fecha;
    const nueva = new Date(vieja.getTime() + DIA);
    await prismaRaw.turno.update({ where: { id: turno.id }, data: { fecha: nueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: turno.id,
      organizationId: o.orgId,
      pacienteId: paciente.id,
      fechaTurno: nueva,
      fechaTurnoPrevia: vieja,
      ahora: AHORA,
    });
    const clave = claveDelTurno(turno.id, nueva);
    // El cron ya lo trató: con canal whatsapp, cancelado sin mandar.
    await prismaRaw.envioSms.update({
      where: { claveIdempotencia: clave },
      data: { estado: "cancelado", motivoNoEnvio: MOTIVO_CANAL_WHATSAPP, cerradoEn: AHORA, proximoIntentoEn: null },
    });

    const despues = new Date(AHORA.getTime() + MIN);
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: despues, fechaTurno: vieja });

    expect(await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: clave } })).toMatchObject({
      motivo: "cambio_de_horario",
      estado: "pendiente",
      programadoEn: despues,
      motivoNoEnvio: null,
      cerradoEn: null,
    });

    // Un recordatorio apagado por baja no revive.
    const otro = await turnoConAvisoHoy(o, { nombre: "Baja" });
    const otraNueva = new Date(otro.turno.fecha.getTime() + DIA);
    await prismaRaw.turno.update({ where: { id: otro.turno.id }, data: { fecha: otraNueva } });
    await reprogramarEnvioDelTurno(db, {
      turnoId: otro.turno.id,
      organizationId: o.orgId,
      pacienteId: otro.paciente.id,
      fechaTurno: otraNueva,
      fechaTurnoPrevia: otro.turno.fecha,
      ahora: AHORA,
    });
    const otraClave = claveDelTurno(otro.turno.id, otraNueva);
    await prismaRaw.envioSms.update({
      where: { claveIdempotencia: otraClave },
      data: { estado: "cancelado", motivoNoEnvio: MOTIVO_BAJA, cerradoEn: AHORA, proximoIntentoEn: null },
    });
    await registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: otro.turno.id, usuarioId: o.userId, ahora: despues, fechaTurno: otro.turno.fecha });
    expect(await prismaRaw.envioSms.findUniqueOrThrow({ where: { claveIdempotencia: otraClave } })).toMatchObject({
      motivo: "recordatorio_turno",
      estado: "cancelado",
    });
  });

  it("toma el lock de la agenda: espera a que termine un cambio de turno en curso", async () => {
    const o = await crearOrg();
    const { turno } = await turnoConAvisoHoy(o);
    let soltar!: () => void;
    const suelto = new Promise<void>((r) => (soltar = r));
    let tomado!: () => void;
    const lockTomado = new Promise<void>((r) => (tomado = r));
    const otra = prismaRaw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${o.orgId}))`;
      tomado();
      await suelto;
    });
    await lockTomado;
    let registrado = false;
    const aviso = registrarAviso({ prisma: db, organizationId: o.orgId, turnoId: turno.id, usuarioId: o.userId, ahora: AHORA }).then(() => {
      registrado = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(registrado).toBe(false);
    soltar();
    await Promise.all([otra, aviso]);
    expect(registrado).toBe(true);
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

  it("GET con canal sms: turnos vacío", async () => {
    const o = await entrar("sms");
    await turnoConAvisoHoy(o);
    const { GET } = await import("@/app/api/recordatorios/whatsapp/route");

    expect(await (await GET()).json()).toEqual({ data: { canal: "sms", turnos: [] } });
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

  it("/api/config: devuelve el canal, se cambia por PATCH y rechaza un canal que no existe", async () => {
    const o = await entrar("sms");
    const { GET, PATCH } = await import("@/app/api/config/route");
    const patch = (body: unknown) =>
      PATCH(new Request("http://localhost/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

    expect((await (await GET()).json()).data.canalRecordatorio).toBe("sms");
    const res = await patch({ canalRecordatorio: "whatsapp" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.canalRecordatorio).toBe("whatsapp");
    expect((await patch({ canalRecordatorio: "paloma" })).status).toBe(400);
    expect((await prismaRaw.configuracion.findUniqueOrThrow({ where: { organizationId: o.orgId } })).canalRecordatorio).toBe("whatsapp");
  });

  it("una configuración creada sin canal queda en sms", async () => {
    const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
    const c = await prismaRaw.configuracion.create({
      data: { organizationId: org.id, nombreProfesional: "X", tarifaDefault: 1 },
    });
    expect(c.canalRecordatorio).toBe("sms");
  });
});

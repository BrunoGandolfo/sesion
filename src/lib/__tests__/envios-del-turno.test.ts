/**
 * Integración — el contrato turno ↔ SMS contra la base real de test:
 * programar, reprogramar, cancelar, y el aviso de cobro.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/envios-del-turno.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  cancelarEnviosDelTurno,
  claveDeCobro,
  claveDelTurno,
  enviosDelTurno,
  MOTIVO_TURNO_CERRADO,
  programarEnvioDeCobro,
  programarEnvioDelTurno,
  reprogramarEnvioDelTurno,
} from "@/app/api/_lib/casos-uso/envios-del-turno";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { calcularProgramadoEn } from "@/lib/recordatorios-programacion";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";
import { MOTIVO_REPROGRAMADO, MOTIVO_SIN_TELEFONO } from "@/lib/glosario";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const HORA = 60 * 60_000;
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const MANANA = new Date("2026-09-04T15:00:00.000Z"); // 12:00 Montevideo
const PASADO_MANANA = new Date("2026-09-05T15:00:00.000Z");

async function fixture(opciones: { telefono?: string; modo?: "dia_anterior" | "dos_dias_antes" | "misma_manana" } = {}) {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  await prismaRaw.configuracion.create({
    data: { organizationId: org.id, nombreProfesional: "M", tarifaDefault: 1000, recordatorioModo: opciones.modo ?? "dia_anterior" },
  });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Lucía", apellido: "Gómez", telefono: opciones.telefono ?? "+59899123456", tarifa: 1000, organizationId: org.id },
  });
  const turno = await prismaRaw.turno.create({
    data: { fecha: MANANA, estado: "programado", tarifaCobrada: 1000, pacienteId: paciente.id, organizationId: org.id },
  });
  return { organizationId: org.id, pacienteId: paciente.id, turnoId: turno.id };
}

const enviosDe = (turnoId: string) => prismaRaw.envioSms.findMany({ where: { turnoId }, orderBy: { creadoEn: "asc" } });

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

describe("programarEnvioDelTurno", () => {
  it("crea un envío pendiente a la hora del modo, con dispersión, y congela el teléfono", async () => {
    const f = await fixture({ modo: "dos_dias_antes" });
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });

    const [envio] = await enviosDe(f.turnoId);
    expect(envio).toMatchObject({
      estado: "pendiente",
      motivo: "recordatorio_turno",
      destino: "+59899123456",
      claveIdempotencia: claveDelTurno(f.turnoId, MANANA),
      organizationId: f.organizationId,
      pacienteId: f.pacienteId,
    });
    expect(envio.programadoEn.getTime()).toBe(calcularProgramadoEn(MANANA, "dos_dias_antes", f.turnoId).getTime());
    expect(envio.proximoIntentoEn?.getTime()).toBe(envio.programadoEn.getTime());
  });

  it("es idempotente: dos llamadas con la misma clave, una sola fila", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    expect(await enviosDe(f.turnoId)).toHaveLength(1);
  });

  it("sin teléfono nace fallido y lo dice enseguida", async () => {
    const f = await fixture({ telefono: "" });
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    const [envio] = await enviosDe(f.turnoId);
    expect(envio).toMatchObject({ estado: "fallido", motivoNoEnvio: MOTIVO_SIN_TELEFONO, proximoIntentoEn: null });
    expect(envio.cerradoEn?.getTime()).toBe(AHORA.getTime());
  });

  it("un turno que ya pasó (o es ahora) no lleva envío", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: AHORA, ahora: AHORA });
    await programarEnvioDelTurno(db, { ...f, fechaTurno: new Date(AHORA.getTime() - 1), ahora: AHORA });
    expect(await enviosDe(f.turnoId)).toHaveLength(0);
  });

  it("revive un envío cancelado que nunca salió (turno reabierto sin tocar la fecha)", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await cancelarEnviosDelTurno(db, f.turnoId);
    expect((await enviosDe(f.turnoId))[0].estado).toBe("cancelado");

    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    const envios = await enviosDe(f.turnoId);
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({ estado: "pendiente", motivoNoEnvio: null, cerradoEn: null });
  });

  it("no revive uno cancelado que SÍ salió (tiene sid)", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await prismaRaw.envioSms.updateMany({ where: { turnoId: f.turnoId }, data: { estado: "cancelado", sid: "SM1", aceptadoEn: AHORA } });
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    expect((await enviosDe(f.turnoId))[0].estado).toBe("cancelado");
  });

  it("funciona adentro de una transacción de Prisma", async () => {
    const f = await fixture();
    await db.$transaction(async (tx) => {
      await programarEnvioDelTurno(tx, { ...f, fechaTurno: MANANA, ahora: AHORA });
    });
    expect(await enviosDe(f.turnoId)).toHaveLength(1);
  });
});

describe("cancelarEnviosDelTurno", () => {
  it("apaga pendiente y enviando con el motivo, no toca lo que ya salió, y es idempotente", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    const [pendiente] = await enviosDe(f.turnoId);
    await prismaRaw.envioSms.create({
      data: { organizationId: f.organizationId, claveIdempotencia: `x:${randomUUID()}`, motivo: "recordatorio_turno", estado: "enviando", pacienteId: f.pacienteId, turnoId: f.turnoId, destino: "+1", programadoEn: AHORA, proximoIntentoEn: AHORA },
    });
    await prismaRaw.envioSms.create({
      data: { organizationId: f.organizationId, claveIdempotencia: `y:${randomUUID()}`, motivo: "recordatorio_turno", estado: "aceptado", sid: "SM9", pacienteId: f.pacienteId, turnoId: f.turnoId, destino: "+1", programadoEn: AHORA, aceptadoEn: AHORA },
    });

    expect(await cancelarEnviosDelTurno(db, f.turnoId)).toBe(2);
    const envios = await enviosDe(f.turnoId);
    expect(envios.filter((e) => e.estado === "cancelado")).toHaveLength(2);
    expect(envios.find((e) => e.id === pendiente.id)?.motivoNoEnvio).toBe(MOTIVO_TURNO_CERRADO);
    expect(envios.find((e) => e.sid === "SM9")?.estado).toBe("aceptado");
    expect(await cancelarEnviosDelTurno(db, f.turnoId)).toBe(0);
  });
});

describe("reprogramarEnvioDelTurno", () => {
  it("sin aviso previo: apaga el viejo y programa el recordatorio de la fecha nueva", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });

    const envios = await enviosDe(f.turnoId);
    expect(envios).toHaveLength(2);
    expect(envios[0]).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_REPROGRAMADO });
    expect(envios[1]).toMatchObject({
      estado: "pendiente",
      motivo: "recordatorio_turno",
      claveIdempotencia: claveDelTurno(f.turnoId, PASADO_MANANA),
    });
    expect(envios[1].programadoEn.getTime()).toBe(calcularProgramadoEn(PASADO_MANANA, "dia_anterior", f.turnoId).getTime());
  });

  it("con el aviso de la fecha previa ya aceptado: el nuevo es un CAMBIO DE HORARIO y sale ya", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await prismaRaw.envioSms.updateMany({ where: { turnoId: f.turnoId }, data: { estado: "aceptado", sid: "SM1", aceptadoEn: AHORA } });

    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });

    const envios = await enviosDe(f.turnoId);
    expect(envios).toHaveLength(2);
    expect(envios[0].estado).toBe("aceptado"); // lo que salió no se toca
    expect(envios[1]).toMatchObject({ estado: "pendiente", motivo: "cambio_de_horario" });
    expect(envios[1].programadoEn.getTime()).toBe(AHORA.getTime());
  });

  it("con el aviso previo en desconocido (pudo haber salido) también es cambio de horario", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await prismaRaw.envioSms.updateMany({ where: { turnoId: f.turnoId }, data: { estado: "desconocido" } });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });
    expect((await enviosDe(f.turnoId))[1].motivo).toBe("cambio_de_horario");
  });

  it("es idempotente: la misma fecha no hace nada; repetir la reprogramación no duplica", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });
    expect(await enviosDe(f.turnoId)).toHaveLength(1);
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: AHORA });
    expect(await enviosDe(f.turnoId)).toHaveLength(2);
  });

  it("una reserva huérfana (enviando) también se apaga al reprogramar: no manda a destiempo", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await prismaRaw.envioSms.updateMany({ where: { turnoId: f.turnoId }, data: { estado: "enviando" } });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: new Date(MANANA.getTime() + HORA), fechaTurnoPrevia: MANANA, ahora: AHORA });
    const envios = await enviosDe(f.turnoId);
    expect(envios[0].estado).toBe("cancelado");
    expect(envios[1].estado).toBe("pendiente");
  });
});

describe("reprogramarEnvioDelTurno: movido dos veces", () => {
  it("A → B → C: si el aviso de A llegó y el de B no, C es CAMBIO DE HORARIO igual", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    // El aviso de A salió (Twilio lo aceptó).
    await prismaRaw.envioSms.updateMany({
      where: { claveIdempotencia: claveDelTurno(f.turnoId, MANANA) },
      data: { estado: "aceptado", sid: `SM${randomUUID().replaceAll("-", "")}`, aceptadoEn: AHORA },
    });
    // A → B: sale el cambio de horario para B... pero todavía no se mandó.
    const t1 = new Date(AHORA.getTime() + HORA);
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: t1 });
    // B → C antes de que el aviso de B saliera.
    const C = new Date(PASADO_MANANA.getTime() + 24 * HORA);
    const t2 = new Date(t1.getTime() + HORA);
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: C, fechaTurnoPrevia: PASADO_MANANA, ahora: t2 });

    const envios = await enviosDe(f.turnoId);
    expect(envios.map((e) => [e.motivo, e.estado])).toEqual([
      ["recordatorio_turno", "aceptado"],
      ["cambio_de_horario", "cancelado"],
      ["cambio_de_horario", "pendiente"],
    ]);
    expect(envios[2].programadoEn).toEqual(t2);
    expect(envios[1].cerradoEn).toEqual(t2);
  });
});

describe("programarEnvioDeCobro", () => {
  it("un aviso por paciente y por día de Montevideo; el segundo del día no crea otro", async () => {
    const f = await fixture();
    const a = await programarEnvioDeCobro(db, { organizationId: f.organizationId, pacienteId: f.pacienteId, ahora: AHORA });
    const b = await programarEnvioDeCobro(db, { organizationId: f.organizationId, pacienteId: f.pacienteId, ahora: new Date(AHORA.getTime() + HORA) });
    expect(a.creado).toBe(true);
    expect(b).toEqual({ envioId: a.envioId, creado: false });
    const envio = await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: a.envioId } });
    expect(envio).toMatchObject({ motivo: "recordatorio_cobro", estado: "pendiente", turnoId: null, claveIdempotencia: claveDeCobro(f.pacienteId, AHORA) });
    expect(claveDeCobro("p", AHORA)).toBe("cobro:p:2026-09-03");
  });

  it("sin teléfono nace fallido", async () => {
    const f = await fixture({ telefono: " " });
    const { envioId } = await programarEnvioDeCobro(db, { organizationId: f.organizationId, pacienteId: f.pacienteId, ahora: AHORA });
    expect(await prismaRaw.envioSms.findUniqueOrThrow({ where: { id: envioId } })).toMatchObject({ estado: "fallido", motivoNoEnvio: MOTIVO_SIN_TELEFONO });
  });
});

describe("enviosDelTurno (lectura para la pantalla)", () => {
  it("devuelve los envíos del turno, el más reciente primero, sin teléfono; otra organización ve lista vacía", async () => {
    const f = await fixture();
    await programarEnvioDelTurno(db, { ...f, fechaTurno: MANANA, ahora: AHORA });
    await reprogramarEnvioDelTurno(db, { ...f, fechaTurno: PASADO_MANANA, fechaTurnoPrevia: MANANA, ahora: new Date(AHORA.getTime() + HORA) });

    const lista = await enviosDelTurno(db, f.organizationId, f.turnoId);

    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ estado: "pendiente", motivo: "recordatorio_turno", intentos: 0, motivoNoEnvio: null });
    expect(lista[1]).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_REPROGRAMADO });
    expect(Object.keys(lista[0]).sort()).toEqual(
      ["aceptadoEn", "cerradoEn", "codigoProveedor", "estado", "id", "intentos", "motivo", "motivoNoEnvio", "programadoEn"],
    );

    const otra = await fixture();
    expect(await enviosDelTurno(db, otra.organizationId, f.turnoId)).toEqual([]);
  });
});

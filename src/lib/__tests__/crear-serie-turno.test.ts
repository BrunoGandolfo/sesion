/**
 * Integración — turnos recurrentes: crearTurno con serie, la independencia
 * de cada turno generado y cancelarRestoDeSerie. Contra la base real de test.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/crear-serie-turno.test.ts
 *
 * Lo que se prueba acá es la regla de la serie. El aviso por WhatsApp de
 * cada turno sale de la lista de Hoy (recordatorios-whatsapp.test.ts), que
 * se arma desde los turnos: no hay nada que programar al crearlos. El
 * cifrado de las notas es el real.
 *
 * Cada caso empieza con la base vacía (vaciarTablas).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { ApiError } from "@/app/api/_lib/responses";
import {
  cancelarRestoDeSerie,
} from "@/app/api/_lib/casos-uso/cancelar-serie-turno";
import { crearTurno } from "@/app/api/_lib/casos-uso/crear-turno";
import { fechasDeSerie } from "@/app/api/_lib/casos-uso/serie-turnos";
import { actualizarTurno } from "@/app/api/_lib/casos-uso/turnos";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { agregarDiasMvd, instanteMvd } from "@/lib/fechas-montevideo";
import { MENSAJE_SIN_SERIE, TURNO_SOLAPADO_CON } from "@/lib/glosario";

import type { PrismaClient } from "@prisma/client";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Martes 15 de septiembre de 2026, 15:00 de Montevideo: tres meses de
// martes son 13 (hasta el 8 de diciembre; el 15 queda afuera). "Ahora" es
// una semana antes, para que todos los turnos sean futuros.
const ANCLA = instanteMvd(2026, 8, 15, 15, 0);
const AHORA = instanteMvd(2026, 8, 8, 10, 0);

async function crearOrg(): Promise<{ orgId: string; pacienteId: string }> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org serie ${randomUUID()}` },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Lucía",
      apellido: "Ferreira",
      telefono: "+59899000001",
      tarifa: 2500,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, pacienteId: paciente.id };
}

async function turnosDeSerie(serieId: string) {
  return prismaRaw.turno.findMany({
    where: { serieId },
    orderBy: { fecha: "asc" },
    select: { id: true, fecha: true, estado: true, serieId: true, organizationId: true },
  });
}

function base(orgId: string, pacienteId: string) {
  return {
    prisma: db,
    organizationId: orgId,
    usuarioId: "usuaria-de-prueba",
    pacienteId,
    fecha: ANCLA,
    duracion: 50 as const,
    modalidad: "presencial" as const,
    notas: "trae el cuaderno",
    ahora: AHORA,
  };
}

beforeAll(() => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  // Mismas opciones de transacción que src/lib/db.ts: crear una serie son
  // unos cuarenta viajes a la base dentro de UNA transacción.
  ({ prisma: prismaRaw, db } = conectarBaseDeTest({ transactionOptions: { maxWait: 30_000, timeout: 30_000 } }));
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await vaciarTablas(prismaRaw);
  await prismaRaw.$disconnect();
  process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("crearTurno con frecuencia", () => {
  it("'unico' agenda un solo turno y no crea serie", async () => {
    const { orgId, pacienteId } = await crearOrg();

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "unico" });

    expect(creado.serie).toBeNull();
    expect(creado.serieId).toBeNull();
    expect(await prismaRaw.serieTurno.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prismaRaw.turno.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("semanal: tres meses de turnos, cada uno con su recordatorio", async () => {
    const { orgId, pacienteId } = await crearOrg();

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });

    expect(creado.fecha).toEqual(ANCLA);
    expect(creado.serie).toMatchObject({ frecuencia: "semanal", creados: 13, omitidas: [] });
    expect(creado.serieId).toBe(creado.serie?.id);

    const serie = await prismaRaw.serieTurno.findUniqueOrThrow({
      where: { id: creado.serie!.id },
    });
    expect(serie).toMatchObject({ organizationId: orgId, pacienteId, frecuencia: "semanal" });
    expect(serie.horaAncla).toEqual(ANCLA);

    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos.map((t) => t.fecha)).toEqual(fechasDeSerie(ANCLA, "semanal"));
    expect(turnos.every((t) => t.estado === "programado")).toBe(true);
  });

  it("quincenal: cada 14 días", async () => {
    const { orgId, pacienteId } = await crearOrg();

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "quincenal" });

    expect(creado.serie).toMatchObject({ frecuencia: "quincenal", creados: 7, omitidas: [] });
    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos.map((t) => t.fecha)).toEqual(fechasDeSerie(ANCLA, "quincenal"));
  });

  it("una repetición que choca se omite, se informa, y el resto se agenda", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const ocupada = agregarDiasMvd(ANCLA, 14);
    await prismaRaw.turno.create({
      data: {
        organizationId: orgId,
        pacienteId,
        fecha: agregarDiasMvd(ocupada, 0),
        duracion: 50,
        tarifaCobrada: 2500,
      },
    });

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });

    expect(creado.serie).toMatchObject({ creados: 12, omitidas: [ocupada] });
    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos).toHaveLength(12);
    expect(turnos.some((t) => t.fecha.getTime() === ocupada.getTime())).toBe(false);
    // El turno que ya estaba sigue solo, sin serie.
    const previo = await prismaRaw.turno.findFirst({ where: { organizationId: orgId, fecha: ocupada } });
    expect(previo?.serieId).toBeNull();
  });

  it("semanal de 120 minutos: cada turno de la serie dura 120", async () => {
    const { orgId, pacienteId } = await crearOrg();

    const creado = await crearTurno({ ...base(orgId, pacienteId), duracion: 120, frecuencia: "semanal" });

    expect(creado.serie).toMatchObject({ creados: 13, omitidas: [] });
    const duraciones = await prismaRaw.turno.findMany({
      where: { serieId: creado.serie!.id },
      select: { duracion: true },
    });
    expect(duraciones).toHaveLength(13);
    expect(duraciones.every((t) => t.duracion === 120)).toBe(true);
  });

  it("una repetición que cae 90 minutos después del inicio de un turno de 120 se omite", async () => {
    // El de 120 empieza a las 13:30 y termina 15:30: el de las 15:00 de la
    // serie lo pisa aunque empiece más de 90 minutos después. Con la ventana
    // escrita a mano en 90, este choque no se veía.
    const { orgId, pacienteId } = await crearOrg();
    const ocupada = agregarDiasMvd(ANCLA, 21);
    await prismaRaw.turno.create({
      data: {
        organizationId: orgId,
        pacienteId,
        fecha: new Date(ocupada.getTime() - 90 * 60_000),
        duracion: 120,
        tarifaCobrada: 2500,
      },
    });

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });

    expect(creado.serie).toMatchObject({ creados: 12, omitidas: [ocupada] });
  });

  it("si el primer turno choca, sale el 409 de siempre y no queda nada", async () => {
    const { orgId, pacienteId } = await crearOrg();
    await prismaRaw.turno.create({
      data: {
        organizationId: orgId,
        pacienteId,
        fecha: agregarDiasMvd(ANCLA, 0),
        duracion: 50,
        tarifaCobrada: 2500,
      },
    });

    await expect(
      crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" }),
    ).rejects.toMatchObject({
      message: TURNO_SOLAPADO_CON("Lucía Ferreira", "15:00", "15:50"),
      status: 409,
    });

    expect(await prismaRaw.serieTurno.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prismaRaw.turno.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("un paciente de otra organización no se puede agendar", async () => {
    const { orgId } = await crearOrg();
    const otra = await crearOrg();

    await expect(
      crearTurno({ ...base(orgId, otra.pacienteId), frecuencia: "semanal" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await prismaRaw.turno.count({ where: { organizationId: orgId } })).toBe(0);
  });
});

describe("cada turno de la serie es independiente", () => {
  it("mover uno no mueve a los demás ni pierde el serieId", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });
    const antes = await turnosDeSerie(creado.serie!.id);
    const tercero = antes[2];
    const nuevaFecha = agregarDiasMvd(tercero.fecha, 1);

    const movido = await actualizarTurno({
      prisma: db,
      organizationId: orgId,
      usuarioId: "usuaria-de-prueba",
      turnoId: tercero.id,
      cambios: { fecha: nuevaFecha },
      ahora: AHORA,
    });

    expect(movido.fecha).toEqual(nuevaFecha);
    expect(movido.serieId).toBe(creado.serie!.id);
    const despues = await turnosDeSerie(creado.serie!.id);
    const restoAntes = antes.filter((t) => t.id !== tercero.id).map((t) => t.fecha);
    const restoDespues = despues.filter((t) => t.id !== tercero.id).map((t) => t.fecha);
    expect(restoDespues).toEqual(restoAntes);
  });

  it("cancelar uno solo deja a los demás programados", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "quincenal" });
    const turnos = await turnosDeSerie(creado.serie!.id);

    await actualizarTurno({
      prisma: db,
      organizationId: orgId,
      usuarioId: "usuaria-de-prueba",
      turnoId: turnos[1].id,
      cambios: { estado: "cancelado" },
      ahora: AHORA,
    });

    const despues = await turnosDeSerie(creado.serie!.id);
    expect(despues.map((t) => t.estado)).toEqual([
      "programado",
      "cancelado",
      ...Array<string>(turnos.length - 2).fill("programado"),
    ]);
  });
});

describe("cancelarRestoDeSerie", () => {
  it("cancela desde ese turno en adelante y no toca realizados, anteriores ni otras organizaciones", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });
    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos).toHaveLength(13);

    // Uno ya realizado (y cobrado), uno cancelado a mano, y uno posterior
    // al punto de corte pero realizado: ninguno se toca.
    await prismaRaw.turno.update({ where: { id: turnos[1].id }, data: { estado: "realizado", pagoEstado: "pagado", pagoFecha: new Date(), pagoMetodo: "efectivo" } });
    await prismaRaw.turno.update({ where: { id: turnos[2].id }, data: { estado: "cancelado" } });
    await prismaRaw.turno.update({ where: { id: turnos[6].id }, data: { estado: "realizado" } });

    // Un turno de otra organización que, por error, apunta a la misma serie.
    const otra = await crearOrg();
    const ajeno = await prismaRaw.turno.create({
      data: {
        organizationId: otra.orgId,
        pacienteId: otra.pacienteId,
        fecha: agregarDiasMvd(ANCLA, 70),
        duracion: 50,
        tarifaCobrada: 2500,
        serieId: creado.serie!.id,
      },
    });

    const resultado = await cancelarRestoDeSerie({
      prisma: db,
      organizationId: orgId,
      usuarioId: "usuaria-de-prueba",
      turnoId: turnos[4].id,
    });

    // Desde el índice 4 hasta el 12 hay 9 turnos; el 6 está realizado.
    expect(resultado).toEqual({ serieId: creado.serie!.id, cancelados: 8 });

    const despues = await turnosDeSerie(creado.serie!.id);
    const propios = despues.filter((t) => t.organizationId === orgId);
    expect(propios.map((t) => t.estado)).toEqual([
      "programado", // 0: anterior al corte
      "realizado", // 1
      "cancelado", // 2: ya estaba
      "programado", // 3: anterior al corte
      "cancelado", // 4: el punto de corte, inclusive
      "cancelado", // 5
      "realizado", // 6: no se toca
      "cancelado",
      "cancelado",
      "cancelado",
      "cancelado",
      "cancelado",
      "cancelado",
    ]);

    const ajenoDespues = await prismaRaw.turno.findUniqueOrThrow({ where: { id: ajeno.id } });
    expect(ajenoDespues.estado).toBe("programado");
  });

  it("un turno suelto no tiene resto que cancelar", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "unico" });

    await expect(
      cancelarRestoDeSerie({ prisma: db, organizationId: orgId, usuarioId: "usuaria-de-prueba", turnoId: creado.id }),
    ).rejects.toMatchObject({ message: MENSAJE_SIN_SERIE, status: 400 });
    expect((await prismaRaw.turno.findUniqueOrThrow({ where: { id: creado.id } })).estado).toBe("programado");
  });

  it("desde otra organización el turno no existe", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const otra = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });

    await expect(
      cancelarRestoDeSerie({ prisma: db, organizationId: otra.orgId, usuarioId: "usuaria-de-prueba", turnoId: creado.id }),
    ).rejects.toMatchObject({ status: 404 });
    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos.every((t) => t.estado === "programado")).toBe(true);
  });
});

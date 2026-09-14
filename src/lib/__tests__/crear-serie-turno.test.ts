/**
 * Integración — turnos recurrentes: crearTurno con serie, la independencia
 * de cada turno generado y cancelarRestoDeSerie. Contra la base real de test.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/crear-serie-turno.test.ts
 *
 * Dos colaboradores se reemplazan, y es a propósito:
 *
 *   - `cifrarTurno` (@/lib/prisma-encryption) es del área 3 y todavía no
 *     está en esta rama. Si existe, se usa el real; si no, un doble que
 *     guarda el texto como bytes. Lo que se prueba acá es la regla de la
 *     serie, no el cifrado (eso lo prueba prisma-encryption.test.ts).
 *   - `recordatorios-del-turno` (área 5) escribe en una tabla que el esquema
 *     nuevo reemplazó. Se reemplaza por un doble que anota las llamadas, y
 *     así además se verifica que CADA turno de la serie pide su recordatorio
 *     y que cancelar el resto apaga uno por turno cancelado.
 *
 * No usa vaciarTablas: otras ramas comparten esta base. Crea su propia
 * organización por test y borra lo suyo al final.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { ApiError } from "@/app/api/_lib/responses";
import {
  cancelarRestoDeSerie,
  MENSAJE_SIN_SERIE,
} from "@/app/api/_lib/casos-uso/cancelar-serie-turno";
import { crearTurno } from "@/app/api/_lib/casos-uso/crear-turno";
import { fechasDeSerie } from "@/app/api/_lib/casos-uso/serie-turnos";
import { actualizarTurno } from "@/app/api/_lib/casos-uso/turnos";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { agregarDiasMvd, instanteMvd } from "@/lib/fechas-montevideo";
import { TURNO_SOLAPADO } from "@/lib/glosario";

import { PrismaClient } from "@prisma/client";

import { withEncryption } from "@/lib/prisma-encryption";

import { urlDeBaseDeTest, type ClienteCifrado } from "./db-test";

const recordatorios = vi.hoisted(() => ({
  programados: [] as string[],
  cerrados: [] as string[],
}));

vi.mock("@/lib/prisma-encryption", async (original) => {
  const real = await original<typeof import("@/lib/prisma-encryption")>();
  const doble = (id: string, campos: { notas?: string | null }) => ({
    id,
    notasEncrypted:
      campos.notas == null ? null : Buffer.from(campos.notas, "utf8"),
  });
  return { ...real, cifrarTurno: "cifrarTurno" in real ? real.cifrarTurno : doble };
});

vi.mock("@/app/api/_lib/casos-uso/recordatorios-del-turno", async (original) => {
  const real =
    await original<typeof import("@/app/api/_lib/casos-uso/recordatorios-del-turno")>();
  return {
    ...real,
    programarRecordatorio: async ({ turnoId }: { turnoId: string }) => {
      recordatorios.programados.push(turnoId);
      return null;
    },
    cerrarRecordatoriosDelTurno: async (_tx: unknown, turnoId: string) => {
      recordatorios.cerrados.push(turnoId);
    },
  };
});

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Martes 15 de septiembre de 2026, 15:00 de Montevideo: tres meses de
// martes son 13 (hasta el 8 de diciembre; el 15 queda afuera). "Ahora" es
// una semana antes, para que todos los turnos sean futuros.
const ANCLA = instanteMvd(2026, 8, 15, 15, 0);
const AHORA = instanteMvd(2026, 8, 8, 10, 0);

const organizaciones: string[] = [];

async function crearOrg(): Promise<{ orgId: string; pacienteId: string }> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org serie ${randomUUID()}` },
  });
  organizaciones.push(org.id);
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
    pacienteId,
    fecha: ANCLA,
    duracion: 50 as const,
    modalidad: "presencial" as const,
    notas: "trae el cuaderno",
    ahora: AHORA,
  };
}

beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  // Mismas opciones de transacción que src/lib/db.ts: crear una serie son
  // unos cuarenta viajes a la base dentro de UNA transacción, y con el
  // timeout por defecto de Prisma (5 s) contra Neon desde afuera de su
  // región la transacción se cierra sola a mitad de camino. La URL pasa por
  // las mismas guardas que conectarBaseDeTest; acá no se llama a
  // vaciarTablas, así que no hace falta el cliente autorizado.
  prismaRaw = new PrismaClient({
    datasources: { db: { url: urlDeBaseDeTest() } },
    transactionOptions: { maxWait: 30_000, timeout: 30_000 },
  });
  db = withEncryption(prismaRaw);
});

beforeEach(() => {
  recordatorios.programados.length = 0;
  recordatorios.cerrados.length = 0;
});

afterEach(async () => {
  // Solo lo propio: turnos, series y pacientes de las organizaciones que
  // creó este archivo. Con deleteMany en todo: si otra rama vació la base
  // en el medio, que no falle además la limpieza.
  for (const orgId of organizaciones.splice(0)) {
    await prismaRaw.turno.deleteMany({ where: { organizationId: orgId } });
    await prismaRaw.serieTurno.deleteMany({ where: { organizationId: orgId } });
    await prismaRaw.paciente.deleteMany({ where: { organizationId: orgId } });
    await prismaRaw.organization.deleteMany({ where: { id: orgId } });
  }
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
  __resetKeyCacheForTests();
});

describe("crearTurno con frecuencia", () => {
  it("'unico' agenda un solo turno y no crea serie", async () => {
    const { orgId, pacienteId } = await crearOrg();

    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "unico" });

    expect(creado.serie).toBeNull();
    expect(creado.serieId).toBeNull();
    expect(await prismaRaw.serieTurno.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prismaRaw.turno.count({ where: { organizationId: orgId } })).toBe(1);
    expect(recordatorios.programados).toEqual([creado.id]);
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
    expect(recordatorios.programados.sort()).toEqual(turnos.map((t) => t.id).sort());
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
    ).rejects.toMatchObject({ message: TURNO_SOLAPADO, status: 409 });

    expect(await prismaRaw.serieTurno.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prismaRaw.turno.count({ where: { organizationId: orgId } })).toBe(1);
    expect(recordatorios.programados).toEqual([]);
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
    await prismaRaw.turno.update({ where: { id: turnos[1].id }, data: { estado: "realizado", pagoEstado: "pagado" } });
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
    const cancelados = propios.filter((t, i) => t.estado === "cancelado" && i >= 4);
    expect(recordatorios.cerrados.sort()).toEqual(cancelados.map((t) => t.id).sort());

    const ajenoDespues = await prismaRaw.turno.findUniqueOrThrow({ where: { id: ajeno.id } });
    expect(ajenoDespues.estado).toBe("programado");
  });

  it("un turno suelto no tiene resto que cancelar", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "unico" });

    await expect(
      cancelarRestoDeSerie({ prisma: db, organizationId: orgId, turnoId: creado.id }),
    ).rejects.toMatchObject({ message: MENSAJE_SIN_SERIE, status: 400 });
    expect((await prismaRaw.turno.findUniqueOrThrow({ where: { id: creado.id } })).estado).toBe("programado");
  });

  it("desde otra organización el turno no existe", async () => {
    const { orgId, pacienteId } = await crearOrg();
    const otra = await crearOrg();
    const creado = await crearTurno({ ...base(orgId, pacienteId), frecuencia: "semanal" });

    await expect(
      cancelarRestoDeSerie({ prisma: db, organizationId: otra.orgId, turnoId: creado.id }),
    ).rejects.toMatchObject({ status: 404 });
    const turnos = await turnosDeSerie(creado.serie!.id);
    expect(turnos.every((t) => t.estado === "programado")).toBe(true);
  });
});

/**
 * Integración — cancelar o reprogramar un turno apaga TODOS sus
 * recordatorios vivos, incluidos los que quedaron reservados ("enviando")
 * por una corrida del cron que se murió. Contra la DB real de test.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/turno-recordatorios.test.ts
 *
 * QUÉ PROTEGE (Codex, P2 sobre el PR #11)
 *
 * El flujo de reprogramación cancelaba sólo los recordatorios en
 * "pendiente" y creaba uno nuevo para la fecha nueva. La reserva huérfana de
 * una corrida muerta sobrevivía: el rescate la levantaba, leía la fecha
 * NUEVA del turno —así que ni siquiera parecía un mensaje viejo— y la
 * mandaba en el acto, días antes de tiempo. Después el recordatorio de
 * reemplazo mandaba otro a su hora. Dos SMS, uno de ellos a destiempo.
 *
 * El test recorre el camino entero: reserva huérfana → PATCH del turno →
 * corrida del despachador. El stub de Twilio no se puede haber llamado.
 *
 * La ruta se conecta a la base de test por el cache global que lee
 * src/lib/db.ts, igual que en multi-tenant.test.ts: por eso el import es
 * dinámico dentro de beforeAll.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  enviarRecordatoriosVencidos,
  type EnviarSms,
} from "@/app/api/_lib/casos-uso/enviar-recordatorios";
import { __resetKeyCacheForTests } from "@/lib/encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getServerSession: async () => {
    if (!sesionActual.organizationId) return null;
    return {
      organizationId: sesionActual.organizationId,
      userId: sesionActual.userId,
      user: {
        id: sesionActual.userId,
        organizationId: sesionActual.organizationId,
      },
    };
  },
}));

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let patchTurno!: Handler;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

/** Instantes UTC explícitos. AHORA es 12:00 de Montevideo del 3/9/2026. */
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TURNO_ORIGINAL = new Date("2026-09-04T15:00:00.000Z");
const TURNO_REPROGRAMADO = new Date("2026-09-10T15:00:00.000Z");

const MAX_INTENTOS = 3;
const TEMPLATE = "Hola {{nombre}}, tu sesión es el {{fecha}} a las {{hora}}.";

const enviaOk: EnviarSms = async () => ({ success: true, sid: "SM1" });

interface Escenario {
  turnoId: string;
  recordatorioId: string;
}

/**
 * Org completa con un turno futuro y un recordatorio que quedó RESERVADO por
 * una corrida que se murió: estado "enviando", intentos en 0, y el
 * actualizado_en corrido hacia atrás para que el lease esté vencido.
 *
 * `actualizado_en` es @updatedAt: Prisma la maneja, así que se toca por SQL.
 */
async function escenarioConReservaHuerfana(): Promise<Escenario> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const user = await prismaRaw.user.create({
    data: {
      email: `${randomUUID()}@test.uy`,
      hashedPassword: "no-importa",
      nombre: "Mariana",
      organizationId: org.id,
    },
  });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      tarifaDefault: 1000,
      templateRecordatorio: TEMPLATE,
      nombreProfesional: "Mariana Roldán",
      direccion: "Rivera 2540",
      whatsappOrigen: "+598 99 876 543",
    },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Lucía",
      apellido: "Gómez",
      telefono: "+59899123456",
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: TURNO_ORIGINAL,
      tarifaCobrada: 1000,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  const recordatorio = await prismaRaw.recordatorio.create({
    data: {
      turnoId: turno.id,
      estado: "enviando",
      intentos: 0,
      programadoEn: new Date(AHORA.getTime() - 60_000),
    },
  });
  await prismaRaw.$executeRaw`
    UPDATE recordatorios SET actualizado_en = ${new Date(
      AHORA.getTime() - 10 * 60_000,
    )} WHERE id = ${recordatorio.id}
  `;

  sesionActual.organizationId = org.id;
  sesionActual.userId = user.id;

  return { turnoId: turno.id, recordatorioId: recordatorio.id };
}

function pedido(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function correrDespachador(enviarSms: EnviarSms) {
  return enviarRecordatoriosVencidos({
    prisma: db,
    ahora: AHORA,
    enviarSms,
    maxIntentos: MAX_INTENTOS,
  });
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  const ruta = await import("@/app/api/turnos/[id]/route");
  patchTurno = ruta.PATCH as Handler;
});

beforeEach(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
  sesionActual.userId = "";
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.NOTES_ENCRYPTION_KEY;
  } else {
    process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  __resetKeyCacheForTests();
});

describe("PATCH /api/turnos/[id] y las reservas huérfanas de recordatorio", () => {
  it("reprogramar apaga la reserva huérfana: el SMS viejo no sale", async () => {
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana();

    const res = await patchTurno(
      pedido({ fecha: TURNO_REPROGRAMADO.toISOString() }),
      { params: Promise.resolve({ id: turnoId }) },
    );
    expect(res.status).toBe(200);

    const vieja = await prismaRaw.recordatorio.findUniqueOrThrow({
      where: { id: recordatorioId },
    });
    expect(vieja.estado).toBe("cancelado");

    // Y el despachador no manda nada: la reserva ya no está viva y el
    // recordatorio nuevo está programado para dentro de varios días.
    const stub = vi.fn(enviaOk);
    const resumen = await correrDespachador(stub);

    expect(stub).not.toHaveBeenCalled();
    expect(resumen.enviados).toBe(0);
    expect(resumen.rescatados).toBe(0);
  });

  it("reprogramar deja UN recordatorio vivo, alineado a la fecha nueva", async () => {
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana();

    await patchTurno(pedido({ fecha: TURNO_REPROGRAMADO.toISOString() }), {
      params: Promise.resolve({ id: turnoId }),
    });

    const vivos = await prismaRaw.recordatorio.findMany({
      where: { turnoId, estado: { in: ["pendiente", "enviando"] } },
    });

    expect(vivos).toHaveLength(1);
    expect(vivos[0].id).not.toBe(recordatorioId);
    expect(vivos[0].estado).toBe("pendiente");
    expect(vivos[0].programadoEn.getTime()).toBeGreaterThan(AHORA.getTime());
  });

  it("cancelar el turno también apaga la reserva huérfana", async () => {
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana();

    const res = await patchTurno(pedido({ estado: "cancelado" }), {
      params: Promise.resolve({ id: turnoId }),
    });
    expect(res.status).toBe(200);

    expect(
      (
        await prismaRaw.recordatorio.findUniqueOrThrow({
          where: { id: recordatorioId },
        })
      ).estado,
    ).toBe("cancelado");

    const stub = vi.fn(enviaOk);
    await correrDespachador(stub);
    expect(stub).not.toHaveBeenCalled();
  });
});

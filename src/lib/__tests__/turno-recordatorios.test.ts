/**
 * Integración — la relación entre el estado de un turno y sus recordatorios,
 * contra la DB real de test. Tres bloques:
 *
 *   1. Cancelar o reprogramar apaga TODOS los recordatorios vivos, incluidos
 *      los reservados ("enviando") por una corrida del cron que se murió.
 *   2. CUALQUIER vía que saque al turno de "programado" —realizado, ausente,
 *      cancelado, reprogramado, cobrado— hace lo mismo.
 *   3. Un turno con fecha pasada no lleva recordatorio.
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
let cobrarTurnoHandler!: Handler;
let crearTurno!: (request: Request) => Promise<Response>;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

/** Instantes UTC explícitos. AHORA es 12:00 de Montevideo del 3/9/2026. */
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TURNO_ORIGINAL = new Date("2026-09-04T15:00:00.000Z");
const TURNO_REPROGRAMADO = new Date("2026-09-10T15:00:00.000Z");

const MAX_INTENTOS = 3;
const TEMPLATE = "Hola {{nombre}}, tu sesión es el {{fecha}} a las {{hora}}.";

const enviaOk: EnviarSms = async () => ({ success: true, sid: "SM1" });

/** Un turno que ya pasó, para el caso de cobrar. */
const TURNO_PASADO = new Date("2026-09-03T14:00:00.000Z");

interface Escenario {
  turnoId: string;
  recordatorioId: string;
}

interface OpcionesEscenario {
  /** "enviando" (reserva huérfana) o "pendiente" (el caso normal). */
  estadoRecordatorio?: string;
  fechaTurno?: Date;
}

/**
 * Org completa con un turno y un recordatorio.
 *
 * Por defecto el recordatorio quedó RESERVADO por una corrida que se murió:
 * estado "enviando", intentos en 0, y el actualizado_en corrido hacia atrás
 * para que el lease esté vencido. Con `estadoRecordatorio: "pendiente"` es el
 * caso normal, el que cubre la regla "un turno cerrado no avisa nada".
 *
 * `actualizado_en` es @updatedAt: Prisma la maneja, así que se toca por SQL.
 */
async function escenarioConReservaHuerfana(
  opciones: OpcionesEscenario = {},
): Promise<Escenario> {
  const estadoRecordatorio = opciones.estadoRecordatorio ?? "enviando";
  const fechaTurno = opciones.fechaTurno ?? TURNO_ORIGINAL;
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
      fecha: fechaTurno,
      tarifaCobrada: 1000,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  const recordatorio = await prismaRaw.recordatorio.create({
    data: {
      turnoId: turno.id,
      estado: estadoRecordatorio,
      intentos: 0,
      programadoEn: new Date(AHORA.getTime() - 60_000),
    },
  });
  if (estadoRecordatorio === "enviando") {
    await prismaRaw.$executeRaw`
      UPDATE recordatorios SET actualizado_en = ${new Date(
        AHORA.getTime() - 10 * 60_000,
      )} WHERE id = ${recordatorio.id}
    `;
  }

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

function pedidoPost(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** El estado en que quedó el recordatorio. */
async function estadoDe(recordatorioId: string): Promise<string> {
  const fila = await prismaRaw.recordatorio.findUniqueOrThrow({
    where: { id: recordatorioId },
  });
  return fila.estado;
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

  const [ruta, rutaCobrar, rutaTurnos] = await Promise.all([
    import("@/app/api/turnos/[id]/route"),
    import("@/app/api/turnos/[id]/cobrar/route"),
    import("@/app/api/turnos/route"),
  ]);
  patchTurno = ruta.PATCH as Handler;
  cobrarTurnoHandler = rutaCobrar.POST as Handler;
  crearTurno = rutaTurnos.POST as (request: Request) => Promise<Response>;
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

// ────────────────────────────────────────────────────────────────────────────
// A1 — un turno que deja de estar programado cierra sus recordatorios,
// por CUALQUIER vía.
//
// Antes esto sólo pasaba al cancelar. Marcar "realizado" —lo hace la pantalla
// de grabar cuando termina la sesión— o "ausente" dejaba el recordatorio
// vivo. Se salvaba de casualidad, porque `estaVencido` del despachador
// descarta turnos cerrados y pasados; pero eso es una red, no la regla, y una
// fila viva es una fila que el rescate puede levantar.
// ────────────────────────────────────────────────────────────────────────────

describe("un turno que deja de estar programado cierra sus recordatorios", () => {
  for (const estado of ["realizado", "ausente", "cancelado"] as const) {
    it(`vía PATCH con estado "${estado}"`, async () => {
      const { turnoId, recordatorioId } = await escenarioConReservaHuerfana({
        estadoRecordatorio: "pendiente",
      });

      const res = await patchTurno(pedido({ estado }), {
        params: Promise.resolve({ id: turnoId }),
      });

      expect(res.status).toBe(200);
      expect(await estadoDe(recordatorioId)).toBe("cancelado");
    });

    it(`vía PATCH con estado "${estado}" también apaga la reserva huérfana`, async () => {
      const { turnoId, recordatorioId } = await escenarioConReservaHuerfana();

      await patchTurno(pedido({ estado }), {
        params: Promise.resolve({ id: turnoId }),
      });

      expect(await estadoDe(recordatorioId)).toBe("cancelado");
    });
  }

  it("vía cobrar: registrar el pago de un turno programado lo cierra", async () => {
    // cobrarTurno sólo deja cobrar un turno programado cuya hora ya pasó, así
    // que el turno del escenario es de hace una hora y el recordatorio quedó
    // pendiente (el cron no llegó a levantarlo).
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana({
      estadoRecordatorio: "pendiente",
      fechaTurno: TURNO_PASADO,
    });

    const res = await cobrarTurnoHandler(pedidoPost({ metodo: "efectivo" }), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(200);
    expect(
      (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } }))
        .estado,
    ).toBe("realizado");
    expect(await estadoDe(recordatorioId)).toBe("cancelado");
  });

  it("vía reprogramación: se apaga el viejo y se crea uno nuevo", async () => {
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana({
      estadoRecordatorio: "pendiente",
    });

    await patchTurno(pedido({ fecha: TURNO_REPROGRAMADO.toISOString() }), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(await estadoDe(recordatorioId)).toBe("cancelado");
    const vivos = await prismaRaw.recordatorio.findMany({
      where: { turnoId, estado: { in: ["pendiente", "enviando"] } },
    });
    expect(vivos).toHaveLength(1);
    expect(vivos[0].id).not.toBe(recordatorioId);
  });

  it("editar un turno sin tocar estado ni fecha NO apaga nada", async () => {
    // La regla es "dejó de estar programado", no "lo tocaron".
    const { turnoId, recordatorioId } = await escenarioConReservaHuerfana({
      estadoRecordatorio: "pendiente",
    });

    const res = await patchTurno(pedido({ notas: "Trajo el informe" }), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(200);
    expect(await estadoDe(recordatorioId)).toBe("pendiente");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A2 — un turno que ya empezó no lleva recordatorio.
//
// /grabar/nuevo crea el turno con `fecha: new Date()` porque la sesión está
// empezando. Antes eso creaba igual un recordatorio, con `programadoEn`
// calculado hacia atrás (las 20:00 de ayer), y el cron le mandaba a la
// paciente un SMS recordándole la sesión que estaba teniendo en ese momento.
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/turnos y los turnos que ya empezaron", () => {
  let pacienteId = "";

  /** Devuelve el id del turno creado y cuántos recordatorios tiene. */
  async function crear(fecha: Date) {
    const res = await crearTurno(
      pedidoPost({
        pacienteId,
        fecha: fecha.toISOString(),
        duracion: 50,
        modalidad: "presencial",
      }),
    );
    const cuerpo = (await res.json()) as {
      data: { id: string };
      recordatorio: unknown;
    };
    const recordatorios = await prismaRaw.recordatorio.findMany({
      where: { turnoId: cuerpo.data.id },
    });
    return { status: res.status, cuerpo, recordatorios };
  }

  beforeEach(async () => {
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
    const paciente = await prismaRaw.paciente.create({
      data: {
        nombre: "Lucía",
        apellido: "Gómez",
        telefono: "+59899123456",
        tarifa: 1000,
        organizationId: org.id,
      },
    });
    pacienteId = paciente.id;
    sesionActual.organizationId = org.id;
    sesionActual.userId = user.id;
  });

  it("un turno futuro sí lleva recordatorio", async () => {
    const { status, cuerpo, recordatorios } = await crear(
      new Date(Date.now() + 3 * 24 * 60 * 60_000),
    );

    expect(status).toBe(201);
    expect(recordatorios).toHaveLength(1);
    expect(recordatorios[0].estado).toBe("pendiente");
    expect(cuerpo.recordatorio).not.toBeNull();
  });

  it("un turno con fecha pasada no lleva recordatorio", async () => {
    const { status, cuerpo, recordatorios } = await crear(
      new Date(Date.now() - 60 * 60_000),
    );

    expect(status).toBe(201);
    expect(recordatorios).toEqual([]);
    expect(cuerpo.recordatorio).toBeNull();
  });

  it("el turno creado al vuelo por /grabar/nuevo (fecha = ahora) tampoco", async () => {
    // Es literalmente lo que manda grabar-view: `new Date().toISOString()`.
    // Entre que el cliente arma la fecha y el servidor la evalúa pasan
    // milisegundos, así que el instante de creación siempre queda en el
    // pasado. El borde exacto (fecha === ahora) cuenta como pasado.
    const { status, recordatorios } = await crear(new Date());

    expect(status).toBe(201);
    expect(recordatorios).toEqual([]);
  });
});

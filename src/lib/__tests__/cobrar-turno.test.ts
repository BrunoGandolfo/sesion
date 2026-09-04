/**
 * Integración — cobrarTurno y descobrarTurno. Corre contra la DB real de
 * test, mismo arreglo que casos-uso-worker.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/cobrar-turno.test.ts
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

import type { PrismaClient } from "@prisma/client";

import {
  cobrarTurno,
  descobrarTurno,
  MENSAJE_AUSENTE,
  MENSAJE_CANCELADO,
  MENSAJE_NO_COBRADO,
  MENSAJE_NO_EMPEZO,
  MENSAJE_YA_COBRADO,
} from "@/app/api/_lib/casos-uso/cobrar-turno";
import { ApiError } from "@/app/api/_lib/responses";
import { __resetKeyCacheForTests } from "@/lib/encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Jueves 3 de septiembre de 2026, 15:00. La sesión de las 14 ya terminó;
// la de las 18 todavía no empezó.
const AHORA = new Date(2026, 8, 3, 15, 0, 0);
const YA_PASO = new Date(2026, 8, 3, 14, 0, 0);
const TODAVIA_NO = new Date(2026, 8, 3, 18, 0, 0);

type Fixture = { orgId: string; pacienteId: string; turnoId: string };

async function crearTurno(opciones: {
  fecha?: Date;
  estado?: string;
  pagoEstado?: string;
  pagoMetodo?: string | null;
  pagoFecha?: Date | null;
} = {}): Promise<Fixture> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Pedro",
      apellido: "Ruiz",
      telefono: "+59899000000",
      tarifa: 2200,
      organizationId: org.id,
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: opciones.fecha ?? YA_PASO,
      estado: opciones.estado ?? "programado",
      pagoEstado: opciones.pagoEstado ?? "pendiente",
      pagoMetodo: opciones.pagoMetodo ?? null,
      pagoFecha: opciones.pagoFecha ?? null,
      tarifaCobrada: 2200,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, pacienteId: paciente.id, turnoId: turno.id };
}

function leerTurno(turnoId: string) {
  return prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } });
}

async function esperarApiError(
  promesa: Promise<unknown>,
  status: number,
): Promise<ApiError> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.status).toBe(status);
    return apiError;
  }
  throw new Error(`Se esperaba ApiError ${status} y la promesa resolvió`);
}

beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  await vaciarTablas(prismaRaw);
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

describe("cobrarTurno — los cuatro estados", () => {
  it("1. programado con la hora ya pasada: lo marca realizado y lo cobra", async () => {
    const { orgId, turnoId } = await crearTurno({
      estado: "programado",
      fecha: YA_PASO,
    });

    const resultado = await cobrarTurno({
      prisma: db,
      turnoId,
      organizationId: orgId,
      metodo: "efectivo",
      fecha: AHORA,
    });

    expect(resultado.estado).toBe("realizado");
    expect(resultado.pagoEstado).toBe("pagado");

    const fila = await leerTurno(turnoId);
    expect(fila.estado).toBe("realizado");
    expect(fila.pagoEstado).toBe("pagado");
    expect(fila.pagoMetodo).toBe("efectivo");
    expect(fila.pagoFecha?.getTime()).toBe(AHORA.getTime());
  });

  it("2. realizado: lo cobra y el estado no cambia", async () => {
    const { orgId, turnoId } = await crearTurno({
      estado: "realizado",
      fecha: YA_PASO,
    });

    const resultado = await cobrarTurno({
      prisma: db,
      turnoId,
      organizationId: orgId,
      metodo: "transferencia",
      fecha: AHORA,
    });

    expect(resultado.estado).toBe("realizado");
    expect(resultado.pagoEstado).toBe("pagado");

    const fila = await leerTurno(turnoId);
    expect(fila.pagoMetodo).toBe("transferencia");
    expect(fila.pagoFecha?.getTime()).toBe(AHORA.getTime());
  });

  it("3. cancelado: 400 y el turno no se toca", async () => {
    const { orgId, turnoId } = await crearTurno({ estado: "cancelado" });

    const error = await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId,
        organizationId: orgId,
        metodo: "efectivo",
        fecha: AHORA,
      }),
      400,
    );
    expect(error.message).toBe(MENSAJE_CANCELADO);

    const fila = await leerTurno(turnoId);
    expect(fila.estado).toBe("cancelado");
    expect(fila.pagoEstado).toBe("pendiente");
    expect(fila.pagoMetodo).toBeNull();
  });

  it("4. ausente: 400 y el turno no se toca", async () => {
    const { orgId, turnoId } = await crearTurno({ estado: "ausente" });

    const error = await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId,
        organizationId: orgId,
        metodo: "efectivo",
        fecha: AHORA,
      }),
      400,
    );
    expect(error.message).toBe(MENSAJE_AUSENTE);

    const fila = await leerTurno(turnoId);
    expect(fila.estado).toBe("ausente");
    expect(fila.pagoEstado).toBe("pendiente");
  });
});

describe("cobrarTurno — los bordes", () => {
  it("programado con la hora todavía por venir: 400 sin cerrar el turno", async () => {
    const { orgId, turnoId } = await crearTurno({
      estado: "programado",
      fecha: TODAVIA_NO,
    });

    const error = await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId,
        organizationId: orgId,
        metodo: "efectivo",
        fecha: AHORA,
      }),
      400,
    );
    expect(error.message).toBe(MENSAJE_NO_EMPEZO);

    const fila = await leerTurno(turnoId);
    expect(fila.estado).toBe("programado");
    expect(fila.pagoEstado).toBe("pendiente");
  });

  it("ya cobrado: 400 y no pisa el método ni la fecha del primer cobro", async () => {
    const primerCobro = new Date(2026, 8, 2, 12, 0, 0);
    const { orgId, turnoId } = await crearTurno({
      estado: "realizado",
      pagoEstado: "pagado",
      pagoMetodo: "efectivo",
      pagoFecha: primerCobro,
    });

    const error = await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId,
        organizationId: orgId,
        metodo: "credito",
        fecha: AHORA,
      }),
      400,
    );
    expect(error.message).toBe(MENSAJE_YA_COBRADO);

    const fila = await leerTurno(turnoId);
    expect(fila.pagoMetodo).toBe("efectivo");
    expect(fila.pagoFecha?.getTime()).toBe(primerCobro.getTime());
  });

  it("turno de otra organización: 404 y no se cobra", async () => {
    const { turnoId } = await crearTurno({ estado: "realizado" });

    await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId,
        organizationId: "otra-org",
        metodo: "efectivo",
        fecha: AHORA,
      }),
      404,
    );

    expect((await leerTurno(turnoId)).pagoEstado).toBe("pendiente");
  });

  it("turno inexistente: 404", async () => {
    const { orgId } = await crearTurno();

    await esperarApiError(
      cobrarTurno({
        prisma: db,
        turnoId: "no-existe",
        organizationId: orgId,
        metodo: "efectivo",
        fecha: AHORA,
      }),
      404,
    );
  });
});

describe("descobrarTurno", () => {
  it("deshace el cobro y deja el estado del turno intacto", async () => {
    const { orgId, turnoId } = await crearTurno({
      estado: "realizado",
      pagoEstado: "pagado",
      pagoMetodo: "efectivo",
      pagoFecha: AHORA,
    });

    const resultado = await descobrarTurno({
      prisma: db,
      turnoId,
      organizationId: orgId,
    });

    expect(resultado.pagoEstado).toBe("pendiente");
    // La sesión ocurrió igual: descobrar es contable, no clínico.
    expect(resultado.estado).toBe("realizado");

    const fila = await leerTurno(turnoId);
    expect(fila.pagoEstado).toBe("pendiente");
    expect(fila.pagoFecha).toBeNull();
    expect(fila.pagoMetodo).toBeNull();
    expect(fila.estado).toBe("realizado");
  });

  it("un turno que no está cobrado: 400", async () => {
    const { orgId, turnoId } = await crearTurno({ estado: "realizado" });

    const error = await esperarApiError(
      descobrarTurno({ prisma: db, turnoId, organizationId: orgId }),
      400,
    );
    expect(error.message).toBe(MENSAJE_NO_COBRADO);
  });

  it("turno de otra organización: 404", async () => {
    const { turnoId } = await crearTurno({
      estado: "realizado",
      pagoEstado: "pagado",
    });

    await esperarApiError(
      descobrarTurno({ prisma: db, turnoId, organizationId: "otra-org" }),
      404,
    );

    expect((await leerTurno(turnoId)).pagoEstado).toBe("pagado");
  });

  it("cobrar y descobrar deja el turno cobrable de nuevo", async () => {
    const { orgId, turnoId } = await crearTurno({
      estado: "programado",
      fecha: YA_PASO,
    });

    await cobrarTurno({
      prisma: db,
      turnoId,
      organizationId: orgId,
      metodo: "efectivo",
      fecha: AHORA,
    });
    await descobrarTurno({ prisma: db, turnoId, organizationId: orgId });

    // Quedó "realizado" del primer cobro, así que el segundo entra por la
    // rama que no cierra el turno.
    const segundo = await cobrarTurno({
      prisma: db,
      turnoId,
      organizationId: orgId,
      metodo: "mercadopago",
      fecha: AHORA,
    });

    expect(segundo.estado).toBe("realizado");
    expect(segundo.pagoEstado).toBe("pagado");
    expect((await leerTurno(turnoId)).pagoMetodo).toBe("mercadopago");
  });
});

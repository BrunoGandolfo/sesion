/**
 * Integración — aislamiento entre organizaciones en los PATCH de paciente,
 * turno y sesión clínica. Contra la DB real de test (DATABASE_URL_TEST).
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/multi-tenant.test.ts
 *
 * CÓMO SE CONECTAN LAS RUTAS A LA BASE DE TEST
 *
 * `src/lib/db.ts` construye el cliente una sola vez y lo cachea en
 * `globalThis.prisma` (el patrón de Next para no abrir una conexión por
 * hot-reload). Acá se aprovecha: se pone el cliente de test en ese global
 * ANTES de importar las rutas, así el `db` que ven es el de la rama de test.
 * Por eso las rutas se importan con `await import(...)` dentro de beforeAll y
 * no con un import estático arriba — un import estático las cargaría antes de
 * que el global esté puesto.
 *
 * La sesión se mockea: estos tests no prueban Auth.js, prueban que con una
 * sesión de la organización A no se pueda tocar una fila de la B.
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

import { __resetKeyCacheForTests } from "@/lib/encryption";
import { cifrarSesion } from "@/lib/prisma-encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

// La sesión que van a leer las rutas. Se cambia por test.
const sesionActual = vi.hoisted(() => ({
  organizationId: "",
  userId: "",
}));

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
      user: { id: sesionActual.userId, organizationId: sesionActual.organizationId },
    };
  },
}));

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let patchPaciente!: Handler;
let patchTurno!: Handler;
let patchSesion!: Handler;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MANANA = new Date("2026-12-01T15:00:00.000Z");

type Org = { orgId: string; userId: string; pacienteId: string };

async function crearOrg(): Promise<Org> {
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
      nombre: "Ana",
      apellido: "Pérez",
      telefono: "+59899000000",
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, userId: user.id, pacienteId: paciente.id };
}

async function crearTurno(org: Org): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: MANANA,
      tarifaCobrada: 1000,
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
    },
  });
  return turno.id;
}

async function crearSesionPendiente(org: Org): Promise<string> {
  const turnoId = await crearTurno(org);
  const sesion = await db.sesionClinica.create({
    data: {
      turnoId,
      organizationId: org.orgId,
      estado: "pendiente",
      ...cifrarSesion({ notaSubjetivo: "S" }),
    },
    select: { id: true },
  });
  return sesion.id;
}

function pedido(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function como(org: Org) {
  sesionActual.organizationId = org.orgId;
  sesionActual.userId = org.userId;
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());

  // El cliente de test entra por el cache global que lee src/lib/db.ts. Tiene
  // que pasar ANTES del import de las rutas.
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  const [rutaPaciente, rutaTurno, rutaSesion] = await Promise.all([
    import("@/app/api/pacientes/[id]/route"),
    import("@/app/api/turnos/[id]/route"),
    import("@/app/api/sesion-clinica/[id]/route"),
  ]);
  patchPaciente = rutaPaciente.PATCH as Handler;
  patchTurno = rutaTurno.PATCH as Handler;
  patchSesion = rutaSesion.PATCH as Handler;
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

describe("PATCH /api/pacientes/[id] — aislamiento entre organizaciones", () => {
  it("la organización dueña puede editar", async () => {
    const a = await crearOrg();
    como(a);

    const res = await patchPaciente(pedido({ nombre: "Ana María" }), {
      params: Promise.resolve({ id: a.pacienteId }),
    });

    expect(res.status).toBe(200);
    const fila = await prismaRaw.paciente.findUniqueOrThrow({
      where: { id: a.pacienteId },
    });
    expect(fila.nombre).toBe("Ana María");
  });

  it("otra organización recibe 404 y no toca la fila", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    como(b);

    const res = await patchPaciente(pedido({ nombre: "Intrusa" }), {
      params: Promise.resolve({ id: a.pacienteId }),
    });

    expect(res.status).toBe(404);
    const fila = await prismaRaw.paciente.findUniqueOrThrow({
      where: { id: a.pacienteId },
    });
    expect(fila.nombre).toBe("Ana");
  });
});

describe("PATCH /api/turnos/[id] — aislamiento entre organizaciones", () => {
  it("la organización dueña puede cancelar su turno", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurno(a);
    como(a);

    const res = await patchTurno(pedido({ estado: "cancelado" }), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(200);
    expect(
      (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } }))
        .estado,
    ).toBe("cancelado");
  });

  it("otra organización recibe 404 y el turno sigue programado", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurno(a);
    const b = await crearOrg();
    como(b);

    const res = await patchTurno(pedido({ estado: "cancelado" }), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(404);
    expect(
      (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } }))
        .estado,
    ).toBe("programado");
  });
});

describe("PATCH /api/sesion-clinica/[id] — aislamiento entre organizaciones", () => {
  it("la organización dueña puede pasar la sesión a grabando", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionPendiente(a);
    como(a);

    const res = await patchSesion(pedido({ estado: "grabando" }), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(200);
    expect(
      (
        await prismaRaw.sesionClinica.findUniqueOrThrow({
          where: { id: sesionId },
        })
      ).estado,
    ).toBe("grabando");
  });

  it("otra organización recibe 404 y la sesión sigue pendiente", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionPendiente(a);
    const b = await crearOrg();
    como(b);

    const res = await patchSesion(pedido({ estado: "grabando" }), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(404);
    expect(
      (
        await prismaRaw.sesionClinica.findUniqueOrThrow({
          where: { id: sesionId },
        })
      ).estado,
    ).toBe("pendiente");
  });
});

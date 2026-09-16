/**
 * Integración — aislamiento entre organizaciones en los PATCH de paciente y
 * turno, el consentimiento al crear una sesión clínica y el descobro. Contra la DB real de test (DATABASE_URL_TEST).
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

import { __resetLlaveroForTests } from "@/lib/llavero";
import { cifrarConsentimiento } from "@/lib/prisma-encryption";
import { obtenerTurnoParaGrabar } from "@/app/api/_lib/casos-uso/obtener-turno-para-grabar";

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

// Como el resto de los tests de rutas: se mockea la capa de auth de la API,
// no Auth.js (que ya no existe: la sesión vive en sesiones_acceso).
vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getSessionActor: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return {
      organizationId: sesionActual.organizationId,
      userId: sesionActual.userId,
      sesionId: "s",
      rol: "titular",
      nombre: "Mariana",
      email: "mariana@test.uy",
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
let descobrarTurno!: Handler;
let crearSesionClinica!: (request: Request) => Promise<Response>;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
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

async function crearTurnoCobrado(org: Org): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: MANANA,
      estado: "realizado",
      tarifaCobrada: 1000,
      pagoEstado: "pagado",
      pagoFecha: MANANA,
      pagoMetodo: "efectivo",
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
    },
  });
  return turno.id;
}

function pedido(body: unknown, method = "PATCH"): Request {
  return new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pedidoSinCuerpo(method: string, query = ""): Request {
  return new Request(`http://localhost/api${query}`, { method });
}

function como(org: Org) {
  sesionActual.organizationId = org.orgId;
  sesionActual.userId = org.userId;
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());

  // El cliente de test entra por el cache global que lee src/lib/db.ts. Tiene
  // que pasar ANTES del import de las rutas.
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  const [
    rutaPaciente,
    rutaTurno,
    rutaCobrar,
    rutaSesionesClinicas,
  ] = await Promise.all([
    import("@/app/api/pacientes/[id]/route"),
    import("@/app/api/turnos/[id]/route"),
    import("@/app/api/turnos/[id]/cobrar/route"),
    import("@/app/api/sesion-clinica/route"),
  ]);
  patchPaciente = rutaPaciente.PATCH as Handler;
  patchTurno = rutaTurno.PATCH as Handler;
  descobrarTurno = rutaCobrar.DELETE as Handler;
  crearSesionClinica = rutaSesionesClinicas.POST as (
    request: Request,
  ) => Promise<Response>;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
  sesionActual.userId = "";
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.CLAVES_CIFRADO;
  } else {
    process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  }
  __resetLlaveroForTests();
});

describe("obtenerTurnoParaGrabar — datos de la pantalla y aislamiento", () => {
  it("devuelve el turno propio y la vigencia de la autorización", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurno(a);
    const leer = () => obtenerTurnoParaGrabar({
      prisma: db, organizationId: a.orgId, turnoId,
    });
    expect(await leer()).toEqual({
      id: turnoId,
      fecha: MANANA,
      paciente: { id: a.pacienteId, nombre: "Ana", apellido: "Pérez" },
      autorizacionVigente: false,
    });

    const consentimiento = await db.consentimientoGrabacion.create({
      data: {
        ...cifrarConsentimiento(randomUUID(), {
          textoCompleto: "Autorización de prueba",
          firmaDigital: "data:image/png;base64,AAAA",
        }),
        pacienteId: a.pacienteId,
        organizationId: a.orgId,
        firmadoEn: MANANA,
        textoVersion: "1.1",
      },
    });
    expect((await leer())?.autorizacionVigente).toBe(true);
    await db.consentimientoGrabacion.update({
      where: { id: consentimiento.id }, data: { revocadoEn: MANANA },
    });
    expect((await leer())?.autorizacionVigente).toBe(false);
  });

  it("no devuelve el turno de otra organización", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    const turnoId = await crearTurno(a);
    expect(await obtenerTurnoParaGrabar({
      prisma: db, organizationId: b.orgId, turnoId,
    })).toBeNull();
  });

  it("devuelve null para un turno inexistente", async () => {
    const a = await crearOrg();
    expect(await obtenerTurnoParaGrabar({
      prisma: db, organizationId: a.orgId, turnoId: randomUUID(),
    })).toBeNull();
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// A4 — el consentimiento se busca con la organización en la pregunta.
//
// POST /api/sesion-clinica lo buscaba sólo por `pacienteId`, mientras la
// página de grabar sí filtraba por organización. Con dos organizaciones, la
// comprobación previa a grabar podía mirar la fila equivocada: la firma de
// una paciente de otra consulta habilitaba la grabación de ésta.
//
// Ahora las dos preguntan por la misma función (`consentimientoVigenteDe`).
// El test recorre el caso que estaba roto: la sesión clínica se pide para un
// turno de la org A, cuya paciente NO firmó, mientras existe un
// consentimiento vigente de otra paciente en la org B.
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/sesion-clinica — el consentimiento es de la organización", () => {
  it("sin consentimiento propio no se puede grabar, aunque otra org tenga uno", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    // La paciente de B firmó; la de A no.
    await prismaRaw.consentimientoGrabacion.create({
      data: {
        pacienteId: b.pacienteId,
        organizationId: b.orgId,
        firmadoEn: new Date(),
        textoVersion: "1.1",
        ...cifrarConsentimiento(randomUUID(), { textoCompleto: "…", firmaDigital: "data:image/png;base64,AAA" }),
      },
    });
    const turnoId = await crearTurno(a);
    como(a);

    const res = await crearSesionClinica(pedido({ turnoId }, "POST"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/consentimiento/i);
    expect(await prismaRaw.sesionClinica.count()).toBe(0);
  });

  it("con el consentimiento propio vigente, sí", async () => {
    const a = await crearOrg();
    await prismaRaw.consentimientoGrabacion.create({
      data: {
        pacienteId: a.pacienteId,
        organizationId: a.orgId,
        firmadoEn: new Date(),
        textoVersion: "1.1",
        ...cifrarConsentimiento(randomUUID(), { textoCompleto: "…", firmaDigital: "data:image/png;base64,AAA" }),
      },
    });
    const turnoId = await crearTurno(a);
    como(a);

    const res = await crearSesionClinica(pedido({ turnoId }, "POST"));

    expect(res.status).toBe(201);
    expect(await prismaRaw.sesionClinica.count()).toBe(1);
  });

  it("una firma REVOCADA no habilita", async () => {
    const a = await crearOrg();
    await prismaRaw.consentimientoGrabacion.create({
      data: {
        pacienteId: a.pacienteId,
        organizationId: a.orgId,
        firmadoEn: new Date(),
        revocadoEn: new Date(),
        textoVersion: "1.1",
        ...cifrarConsentimiento(randomUUID(), { textoCompleto: "…", firmaDigital: "data:image/png;base64,AAA" }),
      },
    });
    const turnoId = await crearTurno(a);
    como(a);

    const res = await crearSesionClinica(pedido({ turnoId }, "POST"));

    expect(res.status).toBe(400);
    expect(await prismaRaw.sesionClinica.count()).toBe(0);
  });
});

describe("DELETE /api/turnos/[id]/cobrar — aislamiento entre organizaciones", () => {
  it("sin versión rechaza el pedido y conserva el pago", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurnoCobrado(a);
    como(a);
    const res = await descobrarTurno(pedidoSinCuerpo("DELETE"), { params: Promise.resolve({ id: turnoId }) });
    expect(res.status).toBe(400);
    expect((await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } })).pagoEstado).toBe("pagado");
  });
  it("la organización dueña puede descobrar su turno", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurnoCobrado(a);
    como(a);

    const res = await descobrarTurno(pedido({ actualizadoEn: (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } })).actualizadoEn.toISOString() }, "DELETE"), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(200);
    const fila = await prismaRaw.turno.findUniqueOrThrow({
      where: { id: turnoId },
    });
    expect(fila.pagoEstado).toBe("pendiente");
    expect(fila.pagoFecha).toBeNull();
    expect(fila.pagoMetodo).toBeNull();
  });

  it("otra organización recibe 404 y el turno sigue cobrado", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurnoCobrado(a);
    const b = await crearOrg();
    como(b);

    const res = await descobrarTurno(pedido({ actualizadoEn: (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } })).actualizadoEn.toISOString() }, "DELETE"), {
      params: Promise.resolve({ id: turnoId }),
    });

    expect(res.status).toBe(404);
    const fila = await prismaRaw.turno.findUniqueOrThrow({
      where: { id: turnoId },
    });
    expect(fila.pagoEstado).toBe("pagado");
    expect(fila.pagoMetodo).toBe("efectivo");
  });
});

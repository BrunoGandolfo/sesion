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
let deleteSesion!: Handler;
let uploadUrl!: Handler;
let descobrarTurno!: Handler;
let reintentarRecordatorio!: Handler;

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

async function crearSesionEnEstado(
  org: Org,
  estado: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const turnoId = await crearTurno(org);
  const sesion = await db.sesionClinica.create({
    data: {
      turnoId,
      organizationId: org.orgId,
      estado,
      ...extra,
      ...cifrarSesion({ notaSubjetivo: "S" }),
    },
    select: { id: true },
  });
  return sesion.id;
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

function pedidoSinCuerpo(method: string): Request {
  return new Request("http://localhost/api", { method });
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

  const [
    rutaPaciente,
    rutaTurno,
    rutaSesion,
    rutaUpload,
    rutaCobrar,
    rutaReintentar,
  ] = await Promise.all([
    import("@/app/api/pacientes/[id]/route"),
    import("@/app/api/turnos/[id]/route"),
    import("@/app/api/sesion-clinica/[id]/route"),
    import("@/app/api/sesion-clinica/[id]/upload-url/route"),
    import("@/app/api/turnos/[id]/cobrar/route"),
    import("@/app/api/recordatorios/[id]/reintentar/route"),
  ]);
  patchPaciente = rutaPaciente.PATCH as Handler;
  patchTurno = rutaTurno.PATCH as Handler;
  patchSesion = rutaSesion.PATCH as Handler;
  deleteSesion = rutaSesion.DELETE as Handler;
  uploadUrl = rutaUpload.POST as Handler;
  descobrarTurno = rutaCobrar.DELETE as Handler;
  reintentarRecordatorio = rutaReintentar.POST as Handler;
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

// ────────────────────────────────────────────────────────────────────────────
// Escrituras por id que hasta ahora no llevaban la organización en el WHERE
//
// Las cuatro hacían `update`/`delete` por id después de comprobar la
// pertenencia con un findFirst. Entre esa lectura y la escritura hay una
// ventana; ahora la pertenencia viaja adentro de la propia sentencia
// (updateMany / deleteMany).
//
// Un test de ruta NO puede provocar esa ventana —el findFirst contesta 404
// antes—, así que lo que fijan estos casos es el contrato observable: con la
// sesión de otra organización, 404 y la fila INTACTA. Si mañana alguien saca
// el findFirst por considerarlo redundante, estos tests siguen en verde
// gracias al where de la escritura; si sacara los dos, se ponen rojos.
// ────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/sesion-clinica/[id] — reintento (error → procesando)", () => {
  it("la organización dueña puede reintentar su sesión con error", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "error", {
      audioR2Key: "audios/a.enc",
      error: "algo salió mal",
      intentos: 3,
    });
    como(a);

    const res = await patchSesion(pedido({ estado: "procesando" }), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(200);
    const fila = await prismaRaw.sesionClinica.findUniqueOrThrow({
      where: { id: sesionId },
    });
    expect(fila.estado).toBe("procesando");
    expect(fila.error).toBeNull();
    expect(fila.intentos).toBe(0);
  });

  it("otra organización recibe 404 y la sesión sigue en error", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "error", {
      audioR2Key: "audios/a.enc",
      error: "algo salió mal",
      intentos: 3,
    });
    const b = await crearOrg();
    como(b);

    const res = await patchSesion(pedido({ estado: "procesando" }), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(404);
    const fila = await prismaRaw.sesionClinica.findUniqueOrThrow({
      where: { id: sesionId },
    });
    expect(fila.estado).toBe("error");
    expect(fila.intentos).toBe(3);
  });
});

describe("DELETE /api/sesion-clinica/[id] — aislamiento entre organizaciones", () => {
  it("la organización dueña descarta su nota en revisión", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "revision");
    como(a);

    const res = await deleteSesion(pedidoSinCuerpo("DELETE"), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(200);
    expect(
      (
        await prismaRaw.sesionClinica.findUniqueOrThrow({
          where: { id: sesionId },
        })
      ).estado,
    ).toBe("error");
  });

  it("otra organización recibe 404 y la nota sigue en revisión", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "revision");
    const b = await crearOrg();
    como(b);

    const res = await deleteSesion(pedidoSinCuerpo("DELETE"), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(404);
    expect(
      (
        await prismaRaw.sesionClinica.findUniqueOrThrow({
          where: { id: sesionId },
        })
      ).estado,
    ).toBe("revision");
  });

  it("otra organización no puede eliminar una sesión con error", async () => {
    // Rama de borrado definitivo: sin audio real no hay nada que borrar en
    // R2, así que sin el aislamiento la fila desaparecería.
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "error");
    const b = await crearOrg();
    como(b);

    const res = await deleteSesion(pedidoSinCuerpo("DELETE"), {
      params: Promise.resolve({ id: sesionId }),
    });

    expect(res.status).toBe(404);
    expect(
      await prismaRaw.sesionClinica.count({ where: { id: sesionId } }),
    ).toBe(1);
  });
});

describe("POST /api/sesion-clinica/[id]/upload-url — aislamiento entre organizaciones", () => {
  it("otra organización recibe 404 y la sesión sigue grabando", async () => {
    const a = await crearOrg();
    const sesionId = await crearSesionEnEstado(a, "grabando");
    const b = await crearOrg();
    como(b);

    const res = await uploadUrl(
      pedido(
        { claveCifrado: "k", iv: "iv", tamanoBytes: 1024, mime: "audio/webm" },
        "POST",
      ),
      { params: Promise.resolve({ id: sesionId }) },
    );

    expect(res.status).toBe(404);
    expect(
      (
        await prismaRaw.sesionClinica.findUniqueOrThrow({
          where: { id: sesionId },
        })
      ).estado,
    ).toBe("grabando");
  });
});

describe("DELETE /api/turnos/[id]/cobrar — aislamiento entre organizaciones", () => {
  it("la organización dueña puede descobrar su turno", async () => {
    const a = await crearOrg();
    const turnoId = await crearTurnoCobrado(a);
    como(a);

    const res = await descobrarTurno(pedidoSinCuerpo("DELETE"), {
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

    const res = await descobrarTurno(pedidoSinCuerpo("DELETE"), {
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

// ────────────────────────────────────────────────────────────────────────────
// POST /api/recordatorios/[id]/reintentar
//
// El recordatorio no tiene columna propia de organización: se filtra por la
// del turno. La LECTURA ya lo hacía; la escritura no, y `updateMany` por id
// revive el recordatorio de cualquier organización — con `programadoEn` en
// ahora, así que el próximo tick del cron le manda el SMS a una paciente que
// no es de quien pidió.
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/recordatorios/[id]/reintentar — aislamiento", () => {
  const MANANA_MAS = new Date("2026-12-02T15:00:00.000Z");

  /** Turno futuro y programado, con un recordatorio que ya agotó intentos. */
  async function crearRecordatorioFallido(org: Org): Promise<string> {
    const turno = await prismaRaw.turno.create({
      data: {
        fecha: MANANA_MAS,
        tarifaCobrada: 1000,
        pacienteId: org.pacienteId,
        organizationId: org.orgId,
      },
    });
    const recordatorio = await prismaRaw.recordatorio.create({
      data: {
        turnoId: turno.id,
        estado: "fallido",
        intentos: 3,
        error: "Twilio caído",
        programadoEn: new Date("2026-12-01T23:00:00.000Z"),
      },
    });
    return recordatorio.id;
  }

  it("la organización dueña puede reintentar", async () => {
    const a = await crearOrg();
    const recordatorioId = await crearRecordatorioFallido(a);
    como(a);

    const res = await reintentarRecordatorio(pedidoSinCuerpo("POST"), {
      params: Promise.resolve({ id: recordatorioId }),
    });

    expect(res.status).toBe(200);
    const fila = await prismaRaw.recordatorio.findUniqueOrThrow({
      where: { id: recordatorioId },
    });
    expect(fila.estado).toBe("pendiente");
    expect(fila.intentos).toBe(0);
    expect(fila.error).toBeNull();
  });

  it("otra organización recibe 404 y el recordatorio sigue fallido", async () => {
    const a = await crearOrg();
    const recordatorioId = await crearRecordatorioFallido(a);
    const b = await crearOrg();
    como(b);

    const res = await reintentarRecordatorio(pedidoSinCuerpo("POST"), {
      params: Promise.resolve({ id: recordatorioId }),
    });

    expect(res.status).toBe(404);
    const fila = await prismaRaw.recordatorio.findUniqueOrThrow({
      where: { id: recordatorioId },
    });
    expect(fila.estado).toBe("fallido");
    expect(fila.intentos).toBe(3);
  });
});

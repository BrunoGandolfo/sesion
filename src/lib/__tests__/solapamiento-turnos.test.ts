/**
 * Solapamiento de turnos — la regla pura en los bordes, y las dos rutas que
 * la aplican contra la DB real de test.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/solapamiento-turnos.test.ts
 *
 * QUÉ PROTEGE
 *
 * Se podían agendar dos turnos a la misma hora sin que nada dijera nada. La
 * app es de una profesional que atiende de a una persona: un solapamiento es
 * siempre un error de tipeo, y sin esta regla se descubre el día del turno,
 * con las dos pacientes en la puerta.
 *
 * EL BORDE QUE IMPORTA
 *
 * Fin == inicio NO es solapamiento. Una agenda seguida (10:00-10:50,
 * 10:50-11:40) es el caso normal del consultorio; rechazarla haría inusable
 * la app, y es el error que se comete al escribir la condición con <= en vez
 * de <.
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
  DURACION_MAXIMA_MIN,
  seSolapan,
} from "@/app/api/_lib/casos-uso/solapamiento-turnos";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { TURNO_SOLAPADO } from "@/lib/glosario";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

// ─────────────────────────────────────────────────────────────────────────────
// La regla, sin base
// ─────────────────────────────────────────────────────────────────────────────

const T = (iso: string) => new Date(iso);

describe("seSolapan", () => {
  const base = { inicio: T("2026-10-05T13:00:00.000Z"), duracionMin: 50 };

  it("el mismo intervalo se solapa consigo mismo", () => {
    expect(seSolapan(base, base)).toBe(true);
  });

  it("uno que empieza en el medio del otro", () => {
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T13:30:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(true);
  });

  it("uno que TERMINA en el medio del otro", () => {
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T12:30:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(true);
  });

  it("uno contenido enteramente en el otro", () => {
    const largo = { inicio: T("2026-10-05T12:00:00.000Z"), duracionMin: 90 };
    expect(seSolapan(largo, base)).toBe(true);
    expect(seSolapan(base, largo)).toBe(true);
  });

  it("fin == inicio NO solapa: la agenda seguida es lo normal", () => {
    // 13:00-13:50 y 13:50-14:40.
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T13:50:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(false);
  });

  it("y al revés: inicio == fin del otro tampoco", () => {
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T12:10:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(false);
  });

  it("un minuto de superposición ya es solapamiento", () => {
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T13:49:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(true);
  });

  it("intervalos lejanos no se solapan", () => {
    expect(
      seSolapan(base, {
        inicio: T("2026-10-05T18:00:00.000Z"),
        duracionMin: 50,
      }),
    ).toBe(false);
  });

  it("es simétrica", () => {
    const otro = { inicio: T("2026-10-05T13:30:00.000Z"), duracionMin: 90 };
    expect(seSolapan(base, otro)).toBe(seSolapan(otro, base));
  });

  it("DURACION_MAXIMA_MIN cubre la duración más larga que acepta la API", () => {
    // La ventana de la consulta se calcula con esta constante: si el schema
    // aceptara una duración mayor, un turno largo que empieza antes de la
    // ventana quedaría fuera y el solapamiento no se detectaría. El schema
    // vive en src/app/api/_lib/schemas.ts (30/45/50/60/90).
    expect(DURACION_MAXIMA_MIN).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Las rutas
// ─────────────────────────────────────────────────────────────────────────────

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

type HandlerConId = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let crearTurno!: (request: Request) => Promise<Response>;
let patchTurno!: HandlerConId;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MS_POR_MINUTO = 60_000;

/** Un turno futuro fijo, redondeado a la hora: la ruta compara con el reloj
 *  real, así que tiene que seguir siendo futuro corra cuando corra. */
function enUnaSemana(offsetMin = 0): Date {
  const base = new Date(Date.now() + 7 * 24 * 60 * MS_POR_MINUTO);
  base.setUTCSeconds(0, 0);
  base.setUTCMinutes(0);
  return new Date(base.getTime() + offsetMin * MS_POR_MINUTO);
}

let pacienteId = "";
let otroPacienteId = "";

async function crearOrgConPacientes() {
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
  const [uno, dos] = await Promise.all([
    prismaRaw.paciente.create({
      data: {
        nombre: "Lucía",
        apellido: "Gómez",
        telefono: "+59899123456",
        tarifa: 1000,
        organizationId: org.id,
      },
    }),
    prismaRaw.paciente.create({
      data: {
        nombre: "Ana",
        apellido: "Pérez",
        telefono: "+59899123457",
        tarifa: 1000,
        organizationId: org.id,
      },
    }),
  ]);
  sesionActual.organizationId = org.id;
  sesionActual.userId = user.id;
  pacienteId = uno.id;
  otroPacienteId = dos.id;
  return org.id;
}

function pedidoPost(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pedidoPatch(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Alta directa en la base, sin pasar por la regla: es el turno CONTRA el
 *  que se prueba. */
async function turnoExistente(
  organizationId: string,
  fecha: Date,
  duracion = 50,
  estado = "programado",
): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha,
      duracion,
      estado,
      tarifaCobrada: 1000,
      pacienteId,
      organizationId,
    },
  });
  return turno.id;
}

async function postTurno(fecha: Date, duracion = 50) {
  const res = await crearTurno(
    pedidoPost({
      pacienteId: otroPacienteId,
      fecha: fecha.toISOString(),
      duracion,
      modalidad: "presencial",
    }),
  );
  return { status: res.status, cuerpo: await res.json() };
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  const [rutaTurnos, rutaTurno] = await Promise.all([
    import("@/app/api/turnos/route"),
    import("@/app/api/turnos/[id]/route"),
  ]);
  crearTurno = rutaTurnos.POST as (request: Request) => Promise<Response>;
  patchTurno = rutaTurno.PATCH as HandlerConId;
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

describe("POST /api/turnos rechaza el horario ocupado", () => {
  it("misma hora exacta: 409 con el mensaje del glosario", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana());

    const { status, cuerpo } = await postTurno(enUnaSemana());

    expect(status).toBe(409);
    expect((cuerpo as { error: string }).error).toBe(TURNO_SOLAPADO);
    // Y no se creó nada.
    expect(await prismaRaw.turno.count()).toBe(1);
  });

  it("se pisa por diez minutos: 409", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana());

    expect((await postTurno(enUnaSemana(40))).status).toBe(409);
  });

  it("empieza justo cuando el otro termina: se agenda", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50);

    const { status } = await postTurno(enUnaSemana(50), 50);

    expect(status).toBe(201);
    expect(await prismaRaw.turno.count()).toBe(2);
  });

  it("termina justo cuando el otro empieza: se agenda", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50);

    expect((await postTurno(enUnaSemana(-50), 50)).status).toBe(201);
  });

  it("un turno cancelado no ocupa el horario", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50, "cancelado");

    expect((await postTurno(enUnaSemana())).status).toBe(201);
  });

  it("un turno al que la paciente no vino tampoco", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50, "ausente");

    expect((await postTurno(enUnaSemana())).status).toBe(201);
  });

  it("un turno YA REALIZADO sí ocupa: no se agenda encima", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50, "realizado");

    expect((await postTurno(enUnaSemana())).status).toBe(409);
  });

  it("el turno de otra organización no estorba", async () => {
    // El horario ocupado es de otra org: con el filtro mal puesto, la
    // agenda de una profesional bloquearía la de otra.
    const ajena = await crearOrgConPacientes();
    await turnoExistente(ajena, enUnaSemana());

    await crearOrgConPacientes();

    expect((await postTurno(enUnaSemana())).status).toBe(201);
  });

  it("un turno largo que empezó antes también se detecta", async () => {
    // El de 90 minutos empieza 60 antes, así que sigue vivo cuando arranca
    // el nuevo. Es el caso que la ventana de la consulta tiene que alcanzar.
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(-60), 90);

    expect((await postTurno(enUnaSemana())).status).toBe(409);
  });
});

describe("PATCH /api/turnos/[id] y el horario ocupado", () => {
  it("mover un turno encima de otro: 409 y no se movió", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(), 50);
    const movido = await turnoExistente(orgId, enUnaSemana(180), 50);

    const res = await patchTurno(
      pedidoPatch({ fecha: enUnaSemana(20).toISOString() }),
      { params: Promise.resolve({ id: movido }) },
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(TURNO_SOLAPADO);
    const fila = await prismaRaw.turno.findUniqueOrThrow({
      where: { id: movido },
    });
    expect(fila.fecha.getTime()).toBe(enUnaSemana(180).getTime());
  });

  it("mover un turno cinco minutos NO lo hace chocar consigo mismo", async () => {
    const orgId = await crearOrgConPacientes();
    const solo = await turnoExistente(orgId, enUnaSemana(), 50);

    const res = await patchTurno(
      pedidoPatch({ fecha: enUnaSemana(5).toISOString() }),
      { params: Promise.resolve({ id: solo }) },
    );

    expect(res.status).toBe(200);
  });

  it("alargar la duración hasta pisar el turno siguiente: 409", async () => {
    const orgId = await crearOrgConPacientes();
    const primero = await turnoExistente(orgId, enUnaSemana(), 50);
    await turnoExistente(orgId, enUnaSemana(50), 50);

    const res = await patchTurno(pedidoPatch({ duracion: 90 }), {
      params: Promise.resolve({ id: primero }),
    });

    expect(res.status).toBe(409);
    expect(
      (await prismaRaw.turno.findUniqueOrThrow({ where: { id: primero } }))
        .duracion,
    ).toBe(50);
  });

  it("reabrir un turno ausente cuyo horario ya lo tomó otro: 409", async () => {
    // La ausencia liberó el hueco y alguien lo ocupó. Deshacerla no puede
    // meter dos turnos a la misma hora.
    const orgId = await crearOrgConPacientes();
    const ausente = await turnoExistente(orgId, enUnaSemana(), 50, "ausente");
    await turnoExistente(orgId, enUnaSemana(), 50, "programado");

    const res = await patchTurno(pedidoPatch({ estado: "programado" }), {
      params: Promise.resolve({ id: ausente }),
    });

    expect(res.status).toBe(409);
    expect(
      (await prismaRaw.turno.findUniqueOrThrow({ where: { id: ausente } }))
        .estado,
    ).toBe("ausente");
  });

  it("editar las notas de un turno que ya estaba solapado sigue funcionando", async () => {
    // Datos de antes de esta regla: no se revalida en cada edición, o el
    // turno quedaría sin poder tocarse nunca más.
    const orgId = await crearOrgConPacientes();
    const uno = await turnoExistente(orgId, enUnaSemana(), 50);
    await turnoExistente(orgId, enUnaSemana(), 50);

    const res = await patchTurno(pedidoPatch({ notas: "Trajo el informe" }), {
      params: Promise.resolve({ id: uno }),
    });

    expect(res.status).toBe(200);
  });

  it("cancelar un turno solapado no se bloquea a sí mismo", async () => {
    // Cancelar es justamente la salida que ofrece el mensaje de error: si la
    // comprobación corriera también al cancelar, no habría forma de salir.
    const orgId = await crearOrgConPacientes();
    const uno = await turnoExistente(orgId, enUnaSemana(), 50);
    await turnoExistente(orgId, enUnaSemana(), 50);

    const res = await patchTurno(pedidoPatch({ estado: "cancelado" }), {
      params: Promise.resolve({ id: uno }),
    });

    expect(res.status).toBe(200);
  });
});

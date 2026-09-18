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

import type { EstadoTurno, PrismaClient } from "@prisma/client";

import {
  DURACION_MAXIMA_MIN,
  seSolapan,
} from "@/app/api/_lib/casos-uso/solapamiento-turnos";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  agregarDiasMvd,
  formatearHoraMvd,
  instanteMvd,
  partesMvd,
} from "@/lib/fechas-montevideo";
import { TURNO_SOLAPADO_CON } from "@/lib/glosario";

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

// La ruta lee la organización de la sesión en base (src/app/api/_lib/auth.ts,
// sin Auth.js): acá se reemplaza por la que fija cada test.
vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: sesionActual.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

type HandlerConId = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let crearTurno!: (request: Request) => Promise<Response>;
let patchTurno!: HandlerConId;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
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
        apellido: "Fernández",
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
  estado: EstadoTurno = "programado",
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

/** El mensaje del 409 contra el turno de Lucía (el de turnoExistente). */
function choqueCon(inicio: Date, duracion = 50): string {
  const fin = new Date(inicio.getTime() + duracion * MS_POR_MINUTO);
  return TURNO_SOLAPADO_CON(
    "Lucía Fernández",
    formatearHoraMvd(inicio),
    formatearHoraMvd(fin),
  );
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
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
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

describe("POST /api/turnos rechaza el horario ocupado", () => {
  it("misma hora exacta: 409 con el mensaje del glosario", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana());

    const { status, cuerpo } = await postTurno(enUnaSemana());

    expect(status).toBe(409);
    expect((cuerpo as { error: string }).error).toBe(choqueCon(enUnaSemana()));
    // Y no se creó nada.
    expect(await prismaRaw.turno.count()).toBe(1);
  });

  it("el 409 dice con quién choca y de qué hora a qué hora, en hora de Montevideo; el log deja ids y fechas, sin nombres", async () => {
    const orgId = await crearOrgConPacientes();
    const { anio, mes, dia } = partesMvd(agregarDiasMvd(new Date(), 7));
    const diezEnPunto = instanteMvd(anio, mes, dia, 10, 0);
    const ocupa = await turnoExistente(orgId, diezEnPunto, 50);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const pedido = instanteMvd(anio, mes, dia, 10, 30);
      const { status, cuerpo } = await postTurno(pedido, 50);

      expect(status).toBe(409);
      const mensaje = (cuerpo as { error: string }).error;
      expect(mensaje).toContain("Lucía Fernández");
      expect(mensaje).toContain("10:00");
      expect(mensaje).toContain("10:50");

      const lineas = aviso.mock.calls.map((c) => String(c[0]));
      const linea = lineas.find((l) => l.startsWith("[turnos] solapamiento"));
      expect(linea).toBeDefined();
      expect(linea).toContain(`pedido=${pedido.toISOString()}`);
      expect(linea).toContain("duracion=50");
      expect(linea).toContain(`ocupa=${ocupa}`);
      expect(linea).toContain(`ocupaFecha=${diezEnPunto.toISOString()}`);
      expect(linea).not.toMatch(/Lucía|Fernández|Pérez/);
    } finally {
      aviso.mockRestore();
    }
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

  it("dos altas simultáneas para el mismo hueco: una entra y la otra no", async () => {
    // Codex P1: meter la comprobación adentro del $transaction NO alcanza.
    // READ COMMITTED no bloquea la AUSENCIA de filas, y `Turno` no tiene
    // restricción de exclusión en la base: las dos leen "libre" y las dos
    // insertan. Lo que lo evita es el lock de asesoría por organización que
    // toma buscarTurnoSolapado antes de leer.
    await crearOrgConPacientes();
    const hueco = enUnaSemana();

    const [a, b] = await Promise.all([postTurno(hueco), postTurno(hueco)]);
    const estados = [a.status, b.status].sort();

    expect(estados).toEqual([201, 409]);
    expect(await prismaRaw.turno.count()).toBe(1);
  });

  it("dos altas simultáneas en horarios distintos entran las dos", async () => {
    // El lock serializa, no bloquea: dos turnos que no se pisan tienen que
    // poder crearse igual.
    await crearOrgConPacientes();

    const [a, b] = await Promise.all([
      postTurno(enUnaSemana()),
      postTurno(enUnaSemana(180)),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await prismaRaw.turno.count()).toBe(2);
  });

  it("un turno largo que empezó antes también se detecta", async () => {
    // El de 90 minutos empieza 60 antes, así que sigue vivo cuando arranca
    // el nuevo. Es el caso que la ventana de la consulta tiene que alcanzar.
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana(-60), 90);

    expect((await postTurno(enUnaSemana())).status).toBe(409);
  });
});

describe("POST /api/turnos con alGrabar: el turno que nace al grabar", () => {
  function postAlGrabar(fecha: Date, extra: Record<string, unknown> = {}) {
    return crearTurno(
      pedidoPost({
        pacienteId: otroPacienteId,
        fecha: fecha.toISOString(),
        duracion: 50,
        modalidad: "presencial",
        alGrabar: true,
        ...extra,
      }),
    );
  }

  it("no pasa por la regla de choques: la sesión ya está ocurriendo", async () => {
    const orgId = await crearOrgConPacientes();
    await turnoExistente(orgId, enUnaSemana());

    const res = await postAlGrabar(enUnaSemana(10));

    expect(res.status).toBe(201);
    expect(await prismaRaw.turno.count()).toBe(2);
  });

  it("no sirve para una serie: 400 y no se crea nada", async () => {
    await crearOrgConPacientes();

    const res = await postAlGrabar(enUnaSemana(), { frecuencia: "semanal" });

    expect(res.status).toBe(400);
    expect(await prismaRaw.turno.count()).toBe(0);
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
    expect((await res.json()).error).toBe(choqueCon(enUnaSemana()));
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

  it("dos PATCH simultáneos sobre el mismo turno componen el intervalo sobre el resultado del otro", async () => {
    // Codex P1 (segunda pasada): el intervalo final se componía con la fila
    // leída ANTES del lock. Uno mueve el turno de 10:00 a 11:00 y el otro le
    // cambia la duración a 90; el segundo espera el lock, valida el intervalo
    // viejo (10:00-11:30), pasa, y su update parcial conserva las 11:00 recién
    // commiteadas: el turno termina en 11:00-12:30, que nadie validó y que
    // pisa al de las 11:30.
    const orgId = await crearOrgConPacientes();
    const movido = await turnoExistente(orgId, enUnaSemana(), 50);
    // El que está en el camino del intervalo no validado.
    await turnoExistente(orgId, enUnaSemana(90), 50);

    const [a, b] = await Promise.all([
      patchTurno(pedidoPatch({ fecha: enUnaSemana(60).toISOString() }), {
        params: Promise.resolve({ id: movido }),
      }),
      patchTurno(pedidoPatch({ duracion: 90 }), {
        params: Promise.resolve({ id: movido }),
      }),
    ]);

    const fila = await prismaRaw.turno.findUniqueOrThrow({
      where: { id: movido },
    });
    const fin =
      fila.fecha.getTime() + fila.duracion * MS_POR_MINUTO;

    // Sea cual sea el orden en que se resolvieron, el turno NO puede haber
    // quedado pisando al de las 11:30. Que uno de los dos falle con 409 es
    // aceptable; que los dos pasen y el resultado se solape, no.
    expect(fin).toBeLessThanOrEqual(enUnaSemana(90).getTime());
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(
      true,
    );
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

/**
 * Integración — pendientesTerapeuta, las tres listas que abren la app.
 * Corre contra la DB real de test, mismo arreglo que casos-uso-worker.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/pendientes-terapeuta.test.ts
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

import { pendientesTerapeuta } from "@/app/api/_lib/casos-uso/pendientes-terapeuta";
import { __resetKeyCacheForTests } from "@/lib/encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

const cuentaActual = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => cuentaActual.id,
  getServerSession: async () => null,
}));
let leerDashboard: typeof import("@/app/api/dashboard/route").GET;
let leerTurnos: typeof import("@/app/api/turnos/route").GET;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Jueves 3 de septiembre de 2026, 15:00, hora local: el día ya empezó y
// todavía quedan turnos por delante.
const AHORA = new Date(2026, 8, 3, 15, 0, 0);
const HOY_TEMPRANO = new Date(2026, 8, 3, 9, 0, 0);
const HOY_TARDE = new Date(2026, 8, 3, 18, 0, 0);
const SEMANA_PASADA = new Date(2026, 7, 27, 10, 0, 0);
const ANTEAYER = new Date(2026, 8, 1, 11, 0, 0);
const MANANA = new Date(2026, 8, 4, 10, 0, 0);

async function crearOrg(): Promise<string> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  return org.id;
}

async function crearPaciente(
  orgId: string,
  nombre = "Ana",
  apellido = "López",
): Promise<string> {
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre,
      apellido,
      telefono: "+59899000000",
      tarifa: 2200,
      organizationId: orgId,
    },
  });
  return paciente.id;
}

async function crearTurno(opciones: {
  orgId: string;
  pacienteId: string;
  fecha: Date;
  estado?: string;
  pagoEstado?: string;
  tarifaCobrada?: number;
}): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: opciones.fecha,
      estado: opciones.estado ?? "programado",
      pagoEstado: opciones.pagoEstado ?? "pendiente",
      tarifaCobrada: opciones.tarifaCobrada ?? 2200,
      pacienteId: opciones.pacienteId,
      organizationId: opciones.orgId,
    },
  });
  return turno.id;
}

async function crearSesion(opciones: {
  orgId: string;
  turnoId: string;
  estado: string;
}): Promise<string> {
  const sesion = await db.sesionClinica.create({
    data: {
      turnoId: opciones.turnoId,
      organizationId: opciones.orgId,
      estado: opciones.estado,
    },
    select: { id: true },
  });
  return sesion.id;
}

async function crearConsentimiento(opciones: {
  orgId: string;
  pacienteId: string;
  revocadoEn?: Date | null;
}): Promise<void> {
  await prismaRaw.consentimientoGrabacion.create({
    data: {
      pacienteId: opciones.pacienteId,
      organizationId: opciones.orgId,
      firmadoEn: SEMANA_PASADA,
      revocadoEn: opciones.revocadoEn ?? null,
      textoVersion: "1.1",
      textoCompleto: "Texto del consentimiento firmado.",
      firmaDigital: "data:image/png;base64,AAAA",
    },
  });
}

function pendientesDe(orgId: string) {
  return pendientesTerapeuta({ prisma: db, organizationId: orgId, ahora: AHORA });
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  leerDashboard = (await import("@/app/api/dashboard/route")).GET;
  leerTurnos = (await import("@/app/api/turnos/route")).GET;
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

describe("pendientesTerapeuta — sin nada pendiente", () => {
  it("devuelve las tres listas vacías", async () => {
    const orgId = await crearOrg();

    const pendientes = await pendientesDe(orgId);

    expect(pendientes).toEqual({
      notasParaRevisar: [],
      sinCobrar: [],
      totalSinCobrar: { sesiones: 0, monto: 0, pacientes: 0 },
      sinAutorizacion: [],
    });
  });
});

describe("pendientesTerapeuta — notasParaRevisar", () => {
  it("trae la nota en revisión de un turno de hace una semana, no solo la de hoy", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Ana", "López");
    const turnoId = await crearTurno({
      orgId,
      pacienteId,
      fecha: SEMANA_PASADA,
      estado: "realizado",
    });
    const sesionId = await crearSesion({ orgId, turnoId, estado: "revision" });

    const { notasParaRevisar } = await pendientesDe(orgId);

    expect(notasParaRevisar).toEqual([
      {
        sesionId,
        turnoId,
        pacienteId,
        pacienteNombre: "Ana López",
        fecha: SEMANA_PASADA.toISOString(),
      },
    ]);
  });

  it("ignora las sesiones que no están en revisión", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);

    for (const estado of ["aprobado", "procesando", "grabando", "error"]) {
      const turnoId = await crearTurno({
        orgId,
        pacienteId,
        fecha: SEMANA_PASADA,
        estado: "realizado",
      });
      await crearSesion({ orgId, turnoId, estado });
    }

    const { notasParaRevisar } = await pendientesDe(orgId);

    expect(notasParaRevisar).toEqual([]);
  });

  it("ordena de la más vieja a la más nueva y no cruza organizaciones", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Ana", "López");

    const turnoNuevo = await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
    });
    const sesionNueva = await crearSesion({
      orgId,
      turnoId: turnoNuevo,
      estado: "revision",
    });

    const turnoViejo = await crearTurno({
      orgId,
      pacienteId,
      fecha: SEMANA_PASADA,
      estado: "realizado",
    });
    const sesionVieja = await crearSesion({
      orgId,
      turnoId: turnoViejo,
      estado: "revision",
    });

    // Otra organización con su propia nota sin aprobar.
    const otraOrg = await crearOrg();
    const otroPaciente = await crearPaciente(otraOrg, "Pedro", "Ruiz");
    const otroTurno = await crearTurno({
      orgId: otraOrg,
      pacienteId: otroPaciente,
      fecha: SEMANA_PASADA,
      estado: "realizado",
    });
    await crearSesion({ orgId: otraOrg, turnoId: otroTurno, estado: "revision" });

    const { notasParaRevisar } = await pendientesDe(orgId);

    expect(notasParaRevisar.map((n) => n.sesionId)).toEqual([
      sesionVieja,
      sesionNueva,
    ]);
  });
});

describe("pendientesTerapeuta — sinCobrar", () => {
  it("trae la deuda de la paciente, no el turno suelto", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Pedro", "Ruiz");
    await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: 3000,
    });

    const { sinCobrar, totalSinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([
      {
        pacienteId,
        pacienteNombre: "Pedro Ruiz",
        sesiones: 1,
        monto: 3000,
        masAntiguo: ANTEAYER.toISOString(),
      },
    ]);
    expect(totalSinCobrar).toEqual({ sesiones: 1, monto: 3000, pacientes: 1 });
  });

  it("suma las sesiones de una misma paciente en una sola fila", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Pedro", "Ruiz");

    await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
      tarifaCobrada: 2200,
    });
    await crearTurno({
      orgId,
      pacienteId,
      fecha: SEMANA_PASADA,
      estado: "realizado",
      tarifaCobrada: 2000,
    });

    const { sinCobrar, totalSinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([
      {
        pacienteId,
        pacienteNombre: "Pedro Ruiz",
        sesiones: 2,
        monto: 4200,
        // La más vieja de las dos, que es la que dice cuánto hace que debe.
        masAntiguo: SEMANA_PASADA.toISOString(),
      },
    ]);
    expect(totalSinCobrar).toEqual({ sesiones: 2, monto: 4200, pacientes: 1 });
  });

  it("deja fuera lo pagado, lo cancelado, lo ausente y lo que todavía no se dio", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);

    await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
      pagoEstado: "pagado",
    });
    await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "cancelado",
      pagoEstado: "pendiente",
    });
    await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "ausente",
      pagoEstado: "pendiente",
    });
    // Agendado para más tarde hoy: la hora no pasó.
    await crearTurno({
      orgId,
      pacienteId,
      fecha: HOY_TARDE,
      estado: "programado",
      pagoEstado: "pendiente",
    });

    const { sinCobrar, totalSinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([]);
    expect(totalSinCobrar).toEqual({ sesiones: 0, monto: 0, pacientes: 0 });
  });

  it("cuenta un turno realizado con fecha futura, igual que Cobros", async () => {
    // La regla de qué es deuda es una sola —`esDeudaPendiente`: realizado y
    // con pago pendiente— y la consulta también: `buscarTurnosConDeuda`, la
    // misma que alimenta /api/deudores y la pantalla de Cobros. Este caso de
    // uso tenía además un `fecha <= ahora` propio, y por ese filtro de más
    // la misma sesión contaba en Cobros y no en Hoy.
    //
    // Un turno realizado con fecha futura no puede existir por la API: el
    // camino que marca un turno como realizado es la grabación de la sesión,
    // y cobrar-turno rechaza con 400 cualquier cosa que no sea un turno ya
    // realizado. Si aparece uno, es una fila escrita a mano en la base, y lo
    // correcto es que las dos pantallas digan lo mismo sobre ella —lo peor
    // posible es que dos pantallas cuenten la misma plata de dos maneras—.
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Pedro", "Ruiz");

    await crearTurno({
      orgId,
      pacienteId,
      fecha: MANANA,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: 3000,
    });

    const { sinCobrar, totalSinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([
      {
        pacienteId,
        pacienteNombre: "Pedro Ruiz",
        sesiones: 1,
        monto: 3000,
        masAntiguo: MANANA.toISOString(),
      },
    ]);
    expect(totalSinCobrar).toEqual({ sesiones: 1, monto: 3000, pacientes: 1 });
  });

  it("ordena por monto descendente y, a igual monto, la deuda más vieja primero", async () => {
    const orgId = await crearOrg();
    const grande = await crearPaciente(orgId, "Pedro", "Ruiz");
    const viejaChica = await crearPaciente(orgId, "Ana", "López");
    const nuevaChica = await crearPaciente(orgId, "Julián", "Paz");

    // 4400 en dos sesiones.
    await crearTurno({
      orgId,
      pacienteId: grande,
      fecha: ANTEAYER,
      estado: "realizado",
      tarifaCobrada: 2200,
    });
    await crearTurno({
      orgId,
      pacienteId: grande,
      fecha: ANTEAYER,
      estado: "realizado",
      tarifaCobrada: 2200,
    });
    // 2200 cada una: desempata la fecha del impago más viejo.
    await crearTurno({
      orgId,
      pacienteId: nuevaChica,
      fecha: ANTEAYER,
      estado: "realizado",
      tarifaCobrada: 2200,
    });
    await crearTurno({
      orgId,
      pacienteId: viejaChica,
      fecha: SEMANA_PASADA,
      estado: "realizado",
      tarifaCobrada: 2200,
    });

    const { sinCobrar, totalSinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar.map((p) => p.pacienteId)).toEqual([
      grande,
      viejaChica,
      nuevaChica,
    ]);
    expect(totalSinCobrar).toEqual({ sesiones: 4, monto: 8800, pacientes: 3 });
  });
});

describe("pendientesTerapeuta — sinAutorizacion", () => {
  it("trae el turno de hoy de una paciente que nunca firmó", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Camila", "Torres");
    const turnoId = await crearTurno({
      orgId,
      pacienteId,
      fecha: HOY_TARDE,
    });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion).toEqual([
      {
        turnoId,
        pacienteId,
        pacienteNombre: "Camila Torres",
        fecha: HOY_TARDE.toISOString(),
      },
    ]);
  });

  it("no trae el turno de una paciente con autorización vigente", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);
    await crearTurno({ orgId, pacienteId, fecha: HOY_TARDE });
    await crearConsentimiento({ orgId, pacienteId });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion).toEqual([]);
  });

  it("vuelve a traerlo si la autorización fue revocada", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);
    const turnoId = await crearTurno({ orgId, pacienteId, fecha: HOY_TARDE });
    await crearConsentimiento({
      orgId,
      pacienteId,
      revocadoEn: new Date(2026, 8, 2, 10, 0, 0),
    });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion.map((t) => t.turnoId)).toEqual([turnoId]);
  });

  it("solo mira los turnos de hoy que todavía se pueden grabar", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);

    // Mañana: todavía no es problema de hoy.
    await crearTurno({ orgId, pacienteId, fecha: MANANA });
    // La semana pasada: ya pasó.
    await crearTurno({
      orgId,
      pacienteId,
      fecha: SEMANA_PASADA,
      estado: "realizado",
    });
    // Hoy pero cancelado o sin la paciente: no hay nada que grabar.
    await crearTurno({
      orgId,
      pacienteId,
      fecha: HOY_TEMPRANO,
      estado: "cancelado",
    });
    await crearTurno({
      orgId,
      pacienteId,
      fecha: HOY_TEMPRANO,
      estado: "ausente",
    });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion).toEqual([]);
  });

  it("incluye el turno de hoy ya realizado y ordena por hora", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);

    const tarde = await crearTurno({ orgId, pacienteId, fecha: HOY_TARDE });
    const temprano = await crearTurno({
      orgId,
      pacienteId,
      fecha: HOY_TEMPRANO,
      estado: "realizado",
    });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion.map((t) => t.turnoId)).toEqual([temprano, tarde]);
  });

  it("no mezcla la autorización de otra paciente ni de otra organización", async () => {
    const orgId = await crearOrg();
    const conFirma = await crearPaciente(orgId, "Ana", "López");
    const sinFirma = await crearPaciente(orgId, "Julián", "Paz");
    await crearConsentimiento({ orgId, pacienteId: conFirma });
    await crearTurno({ orgId, pacienteId: conFirma, fecha: HOY_TEMPRANO });
    const turnoSinFirma = await crearTurno({
      orgId,
      pacienteId: sinFirma,
      fecha: HOY_TARDE,
    });

    const otraOrg = await crearOrg();
    const pacienteOtraOrg = await crearPaciente(otraOrg, "Marta", "Díaz");
    await crearTurno({
      orgId: otraOrg,
      pacienteId: pacienteOtraOrg,
      fecha: HOY_TARDE,
    });

    const { sinAutorizacion } = await pendientesDe(orgId);

    expect(sinAutorizacion.map((t) => t.turnoId)).toEqual([turnoSinFirma]);
  });
});

describe("pendientesTerapeuta — las tres listas juntas", () => {
  it("arma el bloque completo de un día real", async () => {
    const orgId = await crearOrg();
    const ana = await crearPaciente(orgId, "Ana", "López");
    const pedro = await crearPaciente(orgId, "Pedro", "Ruiz");
    const camila = await crearPaciente(orgId, "Camila", "Torres");
    await crearConsentimiento({ orgId, pacienteId: ana });
    await crearConsentimiento({ orgId, pacienteId: pedro });

    // Nota del jueves pasado que quedó sin aprobar.
    const turnoConNota = await crearTurno({
      orgId,
      pacienteId: ana,
      fecha: SEMANA_PASADA,
      estado: "realizado",
      pagoEstado: "pagado",
    });
    const sesionId = await crearSesion({
      orgId,
      turnoId: turnoConNota,
      estado: "revision",
    });

    // Sesión de anteayer sin cobrar.
    await crearTurno({
      orgId,
      pacienteId: pedro,
      fecha: ANTEAYER,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: 2200,
    });

    // Paciente nueva que llega hoy y todavía no firmó.
    const turnoDeHoy = await crearTurno({
      orgId,
      pacienteId: camila,
      fecha: HOY_TARDE,
    });

    const pendientes = await pendientesDe(orgId);

    expect(pendientes.notasParaRevisar.map((n) => n.sesionId)).toEqual([sesionId]);
    expect(pendientes.sinCobrar.map((p) => p.pacienteId)).toEqual([pedro]);
    expect(pendientes.sinCobrar[0].monto).toBe(2200);
    expect(pendientes.sinCobrar[0].sesiones).toBe(1);
    expect(pendientes.totalSinCobrar).toEqual({
      sesiones: 1,
      monto: 2200,
      pacientes: 1,
    });
    expect(pendientes.sinAutorizacion.map((t) => t.turnoId)).toEqual([turnoDeHoy]);
  });
});


describe("GET dashboard y turnos — inicio y acceso a notas", () => {
  it("una cuenta vacía devuelve los tres pasos sin cumplir, aislados de otras cuentas", async () => {
    cuentaActual.id = await crearOrg();
    await prismaRaw.configuracion.create({ data: { organizationId: cuentaActual.id, nombreProfesional: "Mariana", tarifaDefault: 0 } });
    const otra = await crearOrg();
    const paciente = await crearPaciente(otra);
    await crearTurno({ orgId: otra, pacienteId: paciente, fecha: new Date() });
    const respuesta = await leerDashboard();
    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).data.inicio).toEqual({ tarifaCargada: false, tienePacientes: false, tieneTurnos: false });
  });

  it("cuenta pacientes activos y turnos de cualquier fecha y transmite la nota en Hoy y Agenda", async () => {
    cuentaActual.id = await crearOrg();
    await prismaRaw.configuracion.create({ data: { organizationId: cuentaActual.id, nombreProfesional: "Mariana", tarifaDefault: 2200 } });
    const pacienteId = await crearPaciente(cuentaActual.id);
    const fecha = new Date();
    const turnoId = await crearTurno({ orgId: cuentaActual.id, pacienteId, fecha });
    const sesionId = await crearSesion({ orgId: cuentaActual.id, turnoId, estado: "aprobado" });
    const sinNotaId = await crearTurno({ orgId: cuentaActual.id, pacienteId, fecha });
    const respuesta = await leerDashboard();
    expect(respuesta.status).toBe(200);
    const { data } = await respuesta.json();
    expect(data.inicio).toEqual({ tarifaCargada: true, tienePacientes: true, tieneTurnos: true });
    expect(data.sesionesHoy.find((t: { id: string }) => t.id === turnoId).sesionClinica).toEqual({ id: sesionId, estado: "aprobado" });
    expect(data.sesionesHoy.find((t: { id: string }) => t.id === sinNotaId).sesionClinica).toBeNull();
    const params = new URLSearchParams({ desde: new Date(fecha.getTime() - 60000).toISOString(), hasta: new Date(fecha.getTime() + 60000).toISOString() });
    const agenda = await leerTurnos(new Request(`http://localhost/api/turnos?${params}`));
    expect(agenda.status).toBe(200);
    const lista = (await agenda.json()).data;
    expect(lista.find((t: { id: string }) => t.id === turnoId).sesionClinica).toEqual({ id: sesionId, estado: "aprobado" });
    expect(lista.find((t: { id: string }) => t.id === sinNotaId).sesionClinica).toBeNull();
    await prismaRaw.paciente.update({ where: { id: pacienteId }, data: { activo: false } });
    await prismaRaw.turno.updateMany({ where: { organizationId: cuentaActual.id }, data: { fecha: SEMANA_PASADA } });
    expect((await (await leerDashboard()).json()).data.inicio).toEqual({ tarifaCargada: true, tienePacientes: false, tieneTurnos: true });
  });
});

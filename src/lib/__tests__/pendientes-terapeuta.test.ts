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
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { pendientesTerapeuta } from "@/app/api/_lib/casos-uso/pendientes-terapeuta";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { withEncryption } from "@/lib/prisma-encryption";

function loadEnvTest(): void {
  if (process.env.DATABASE_URL_TEST) return;
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.test"), "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* archivo opcional */
  }
}

loadEnvTest();

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    "DATABASE_URL_TEST es obligatorio para los tests de integración de casos de uso.",
  );
}

let prismaRaw!: PrismaClient;
let db!: ReturnType<typeof withEncryption<PrismaClient>>;

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

async function truncateAll(): Promise<void> {
  await prismaRaw.$executeRawUnsafe(
    `TRUNCATE TABLE
       "paciente_contexto_clinico",
       "sesiones_clinicas",
       "consentimientos_grabacion",
       "recordatorios",
       "turnos",
       "hot_words",
       "pacientes",
       "configuraciones",
       "usuarios",
       "organizaciones"
     RESTART IDENTITY CASCADE`,
  );
}

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

beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  prismaRaw = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_TEST } },
  });
  db = withEncryption(prismaRaw);
});

beforeEach(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  await truncateAll();
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
  it("trae la sesión realizada e impaga con su tarifa", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId, "Pedro", "Ruiz");
    const turnoId = await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: 3000,
    });

    const { sinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([
      {
        turnoId,
        pacienteId,
        pacienteNombre: "Pedro Ruiz",
        fecha: ANTEAYER.toISOString(),
        tarifa: 3000,
      },
    ]);
  });

  it("deja fuera lo pagado, lo cancelado, lo ausente y lo que todavía no pasó", async () => {
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
    // Anomalía defensiva: marcado realizado con fecha futura.
    await crearTurno({
      orgId,
      pacienteId,
      fecha: MANANA,
      estado: "realizado",
      pagoEstado: "pendiente",
    });

    const { sinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar).toEqual([]);
  });

  it("ordena de la más vieja a la más nueva", async () => {
    const orgId = await crearOrg();
    const pacienteId = await crearPaciente(orgId);

    const reciente = await crearTurno({
      orgId,
      pacienteId,
      fecha: ANTEAYER,
      estado: "realizado",
    });
    const vieja = await crearTurno({
      orgId,
      pacienteId,
      fecha: SEMANA_PASADA,
      estado: "realizado",
    });

    const { sinCobrar } = await pendientesDe(orgId);

    expect(sinCobrar.map((s) => s.turnoId)).toEqual([vieja, reciente]);
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
    const turnoImpago = await crearTurno({
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
    expect(pendientes.sinCobrar.map((s) => s.turnoId)).toEqual([turnoImpago]);
    expect(pendientes.sinCobrar[0].tarifa).toBe(2200);
    expect(pendientes.sinAutorizacion.map((t) => t.turnoId)).toEqual([turnoDeHoy]);
  });
});

/**
 * Integración — casos de uso que consume el worker Python. Corren contra la
 * DB real de test (DATABASE_URL_TEST), mismo arreglo que
 * prisma-encryption.test.ts.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/casos-uso-worker.test.ts
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

import { reclamarPendientes } from "@/app/api/_lib/casos-uso/reclamar-pendientes";
import {
  contarSesionesSinContextoAtrasadas,
  estaIntegrada,
  sesionesSinContexto,
} from "@/app/api/_lib/casos-uso/sesiones-sin-contexto";
import { terminosAsr } from "@/app/api/_lib/casos-uso/terminos-asr";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { cifrarSesion } from "@/lib/prisma-encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

// El módulo se mockea envolviendo la implementación real: todos los tests
// siguen consultando la base de verdad, y el de la caída best-effort puede
// hacer explotar una sola llamada con mockRejectedValueOnce.
vi.mock("@/app/api/_lib/casos-uso/terminos-asr", async (importarOriginal) => {
  const original =
    await importarOriginal<
      typeof import("@/app/api/_lib/casos-uso/terminos-asr")
    >();
  return { ...original, terminosAsr: vi.fn(original.terminosAsr) };
});

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Anclado en el pasado: Prisma renueva updatedAt con el reloj real al
// reclamar, y las aserciones "lease renovado" comparan contra este valor.
const AHORA = new Date(2020, 0, 15, 12, 0, 0);
const LEASE_MINUTOS = 45;
const MAX_INTENTOS = 3;

type Base = { orgId: string; pacienteId: string };

async function crearBase(): Promise<Base> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
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
  return { orgId: org.id, pacienteId: paciente.id };
}

async function crearTurno(base: Base, fecha: Date): Promise<string> {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha,
      tarifaCobrada: 1000,
      pacienteId: base.pacienteId,
      organizationId: base.orgId,
    },
  });
  return turno.id;
}

async function crearProcesando(
  base: Base,
  opciones: { intentos: number; datosEstructurados?: string },
): Promise<string> {
  const turnoId = await crearTurno(base, AHORA);
  const sesion = await db.sesionClinica.create({
    data: {
      turnoId,
      organizationId: base.orgId,
      estado: "procesando",
      intentos: opciones.intentos,
      audioR2Key: `audio/${base.orgId}/x/${turnoId}.enc`,
      duracionAudioSeg: 1800,
      ...cifrarSesion({ datosEstructurados: opciones.datosEstructurados }),
    },
    select: { id: true },
  });
  return sesion.id;
}

// @updatedAt lo escribe Prisma en cada write; para simular un lease vencido
// se pisa la columna por SQL después de crear la fila.
async function fijarUpdatedAt(sesionId: string, fecha: Date): Promise<void> {
  await prismaRaw.$executeRawUnsafe(
    `UPDATE sesiones_clinicas SET "updatedAt" = $1 WHERE id = $2`,
    fecha,
    sesionId,
  );
}

async function leerSesion(id: string) {
  return prismaRaw.sesionClinica.findUniqueOrThrow({
    where: { id },
    select: { estado: true, intentos: true, updatedAt: true, error: true },
  });
}

async function crearHotWord(
  base: Base,
  datos: {
    termino: string;
    scope: string;
    pacienteId?: string | null;
    activo?: boolean;
    organizationId?: string;
  },
): Promise<void> {
  await prismaRaw.hotWord.create({
    data: {
      organizationId: datos.organizationId ?? base.orgId,
      termino: datos.termino,
      scope: datos.scope,
      pacienteId: datos.pacienteId ?? null,
      activo: datos.activo ?? true,
    },
  });
}

async function crearPaciente(orgId: string): Promise<string> {
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Otra",
      apellido: "Persona",
      telefono: "+59899000001",
      tarifa: 1000,
      organizationId: orgId,
    },
  });
  return paciente.id;
}

function reclamar() {
  return reclamarPendientes({
    prisma: db,
    ahora: AHORA,
    limite: 5,
    leaseMinutos: LEASE_MINUTOS,
    maxIntentos: MAX_INTENTOS,
  });
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

describe("reclamarPendientes", () => {
  it("toma una sesión en procesando sin lease y le pone lease (intentos 1, updatedAt renovado)", async () => {
    const base = await crearBase();
    const id = await crearProcesando(base, { intentos: 0 });
    const antes = await leerSesion(id);

    const reclamadas = await reclamar();

    expect(reclamadas.map((r) => r.sesionClinicaId)).toEqual([id]);
    expect(reclamadas[0].intento).toBe(1);
    expect(reclamadas[0].pacienteId).toBe(base.pacienteId);
    expect(reclamadas[0].orientacionTeorica).toBe("cbt_mi");

    const despues = await leerSesion(id);
    expect(despues.estado).toBe("procesando");
    expect(despues.intentos).toBe(1);
    expect(despues.updatedAt.getTime()).toBeGreaterThanOrEqual(
      antes.updatedAt.getTime(),
    );
  });

  it("no toma una sesión con lease vigente", async () => {
    const base = await crearBase();
    const id = await crearProcesando(base, { intentos: 1 });
    // updatedAt reciente respecto de AHORA: lease vigente.
    await fijarUpdatedAt(id, new Date(AHORA.getTime() - 5 * 60000));

    const reclamadas = await reclamar();

    expect(reclamadas).toEqual([]);
    expect((await leerSesion(id)).intentos).toBe(1);
  });

  it("retoma una sesión con lease vencido con intentos+1", async () => {
    const base = await crearBase();
    const id = await crearProcesando(base, { intentos: 1 });
    const vencidoHace = new Date(
      AHORA.getTime() - (LEASE_MINUTOS + 1) * 60000,
    );
    await fijarUpdatedAt(id, vencidoHace);

    const reclamadas = await reclamar();

    expect(reclamadas.map((r) => r.sesionClinicaId)).toEqual([id]);
    expect(reclamadas[0].intento).toBe(2);
    const fila = await leerSesion(id);
    expect(fila.intentos).toBe(2);
    expect(fila.updatedAt.getTime()).toBeGreaterThan(vencidoHace.getTime());
  });

  it("al superar el tope pasa a error y no se entrega", async () => {
    const base = await crearBase();
    const id = await crearProcesando(base, { intentos: MAX_INTENTOS });
    await fijarUpdatedAt(id, new Date(AHORA.getTime() - 24 * 60 * 60000));

    const reclamadas = await reclamar();

    expect(reclamadas).toEqual([]);
    const fila = await leerSesion(id);
    expect(fila.estado).toBe("error");
    expect(fila.intentos).toBe(MAX_INTENTOS);
    expect(fila.error).toMatch(/agotaron los reintentos/);
  });

  it("entrega clave e IV del stash y la orientación de la organización", async () => {
    const base = await crearBase();
    await prismaRaw.configuracion.create({
      data: {
        organizationId: base.orgId,
        nombreProfesional: "Mariana",
        tarifaDefault: 1000,
        orientacionTeorica: "gestalt",
      },
    });
    const id = await crearProcesando(base, {
      intentos: 0,
      datosEstructurados: JSON.stringify({
        _audioCifradoTemporal: { claveCifrado: "k1", ivCifrado: "iv1" },
      }),
    });

    const [reclamada] = await reclamar();

    expect(reclamada.sesionClinicaId).toBe(id);
    expect(reclamada.claveCifrado).toBe("k1");
    expect(reclamada.iv).toBe("iv1");
    expect(reclamada.orientacionTeorica).toBe("gestalt");
  });

  it("entrega el vocabulario de la sesión y vacío cuando no hay ninguno", async () => {
    const base = await crearBase();
    const id = await crearProcesando(base, { intentos: 0 });

    const [sinVocabulario] = await reclamar();
    expect(sinVocabulario.sesionClinicaId).toBe(id);
    expect(sinVocabulario.terminosAsr).toEqual([]);

    // Segunda sesión, ya con vocabulario cargado: entra lo de la cuenta y lo
    // de esta paciente, no lo de otra.
    const otroPacienteId = await crearPaciente(base.orgId);
    await crearHotWord(base, { termino: "encuadre", scope: "global" });
    await crearHotWord(base, { termino: "gestalt", scope: "profesional" });
    await crearHotWord(base, {
      termino: "Cachila",
      scope: "paciente",
      pacienteId: base.pacienteId,
    });
    await crearHotWord(base, {
      termino: "Rocha",
      scope: "paciente",
      pacienteId: otroPacienteId,
    });

    const id2 = await crearProcesando(base, { intentos: 0 });
    const reclamadas = await reclamar();
    const conVocabulario = reclamadas.find((r) => r.sesionClinicaId === id2);

    expect(conVocabulario?.terminosAsr).toEqual([
      "Cachila",
      "encuadre",
      "gestalt",
    ]);
  });

  it("si el vocabulario falla, la sesión se entrega igual y no arrastra al resto del lote", async () => {
    const base = await crearBase();
    await crearHotWord(base, { termino: "encuadre", scope: "global" });

    // Dos sesiones en el mismo lote. Cuál se lleva el rechazo depende del
    // orden de reclamo, y las dos se crean en el mismo instante: el test no
    // lo asume, mira cuál volvió sin términos.
    const primera = await crearProcesando(base, { intentos: 0 });
    const segunda = await crearProcesando(base, { intentos: 0 });

    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(terminosAsr).mockRejectedValueOnce(
      new Error("la base dijo que no"),
    );

    let reclamadas;
    let llamadasAlLog;
    try {
      reclamadas = await reclamar();
    } finally {
      // Copiadas antes de restaurar: mockRestore también limpia mock.calls.
      llamadasAlLog = [...avisos.mock.calls];
      avisos.mockRestore();
    }

    // Las dos entregadas: una sin términos (la que falló) y la otra con los
    // suyos. La falla de una no se lleva puesta a la otra.
    expect(reclamadas.map((r) => r.sesionClinicaId).sort()).toEqual(
      [primera, segunda].sort(),
    );
    const fallada = reclamadas.filter((r) => r.terminosAsr.length === 0);
    const sanas = reclamadas.filter((r) => r.terminosAsr.length > 0);
    expect(fallada).toHaveLength(1);
    expect(sanas).toHaveLength(1);
    expect(sanas[0].terminosAsr).toEqual(["encuadre"]);

    // Y las dos quedan reclamadas de verdad, no a medias.
    for (const id of [primera, segunda]) {
      const fila = await leerSesion(id);
      expect(fila.intentos).toBe(1);
      expect(fila.estado).toBe("procesando");
    }

    // El aviso dice cuál falló y de qué; los términos no se loguean nunca.
    expect(llamadasAlLog).toHaveLength(1);
    const [mensaje, detalle] = llamadasAlLog[0];
    expect(mensaje).toContain("[reclamar-pendientes]");
    expect(detalle).toEqual({
      sesionClinicaId: fallada[0].sesionClinicaId,
      tipoError: "Error",
    });
    expect(JSON.stringify(llamadasAlLog)).not.toContain("encuadre");
  });
});

describe("terminosAsr", () => {
  it("suma global, profesional y el de esa paciente; deja fuera el de otra", async () => {
    const base = await crearBase();
    const otroPacienteId = await crearPaciente(base.orgId);

    await crearHotWord(base, { termino: "encuadre", scope: "global" });
    await crearHotWord(base, { termino: "gestalt", scope: "profesional" });
    await crearHotWord(base, {
      termino: "Cachila",
      scope: "paciente",
      pacienteId: base.pacienteId,
    });
    await crearHotWord(base, {
      termino: "Rocha",
      scope: "paciente",
      pacienteId: otroPacienteId,
    });

    const terminos = await terminosAsr({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
    });

    expect(terminos).toEqual(["Cachila", "encuadre", "gestalt"]);
  });

  it("no entrega los inactivos", async () => {
    const base = await crearBase();
    await crearHotWord(base, { termino: "activo", scope: "global" });
    await crearHotWord(base, {
      termino: "apagado",
      scope: "global",
      activo: false,
    });

    const terminos = await terminosAsr({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
    });

    expect(terminos).toEqual(["activo"]);
  });

  it("no entrega el vocabulario de otra organización", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearHotWord(base, { termino: "propio", scope: "global" });
    await crearHotWord(otra, { termino: "ajeno", scope: "global" });

    const terminos = await terminosAsr({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
    });

    expect(terminos).toEqual(["propio"]);
  });

  it("deduplica el mismo término cargado en dos scopes y ordena", async () => {
    const base = await crearBase();
    await crearHotWord(base, { termino: "transferencia", scope: "global" });
    await crearHotWord(base, {
      termino: "transferencia",
      scope: "profesional",
    });
    await crearHotWord(base, { termino: "abulia", scope: "global" });
    await crearHotWord(base, {
      termino: "zapallo",
      scope: "paciente",
      pacienteId: base.pacienteId,
    });

    const terminos = await terminosAsr({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
    });

    expect(terminos).toEqual(["abulia", "transferencia", "zapallo"]);
  });

  it("sin vocabulario cargado devuelve una lista vacía, no null", async () => {
    const base = await crearBase();

    const terminos = await terminosAsr({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
    });

    expect(terminos).toEqual([]);
  });
});

describe("sesionesSinContexto", () => {
  const DESDE = new Date(2020, 0, 1, 0, 0, 0);
  const dia = (n: number, h: number) => new Date(2020, 0, n, h, 0, 0);

  async function crearAprobada(base: Base, fechaTurno: Date, aprobadoEn: Date) {
    const turnoId = await crearTurno(base, fechaTurno);
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: base.orgId,
        estado: "aprobado",
        aprobadoEn,
        ...cifrarSesion({
          notaSubjetivo: "S",
          notaObjetivo: "O",
          notaAnalisis: "A",
          notaPlan: "P",
        }),
      },
      select: { id: true },
    });
    return sesion.id;
  }

  it("devuelve una aprobada que todavía no fue integrada", async () => {
    const base = await crearBase();
    const id = await crearAprobada(base, AHORA, AHORA);

    const resultado = await sesionesSinContexto({
      prisma: db,
      desde: DESDE,
      limite: 5,
    });

    expect(resultado.map((r) => r.sesionClinicaId)).toEqual([id]);
    expect(resultado[0].pacienteId).toBe(base.pacienteId);
    expect(resultado[0].numeroSesion).toBe(1);
    expect(resultado[0].nota).toEqual({
      subjetivo: "S",
      objetivo: "O",
      analisis: "A",
      plan: "P",
    });
    expect(resultado[0].contextoActual).toBeNull();
  });

  it("no devuelve una aprobada cuyo contexto ya apunta a ella", async () => {
    const base = await crearBase();
    const id = await crearAprobada(base, AHORA, AHORA);
    await prismaRaw.pacienteContextoClinico.create({
      data: {
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
        ultimaSesionId: id,
      },
    });

    const resultado = await sesionesSinContexto({
      prisma: db,
      desde: DESDE,
      limite: 5,
    });

    expect(resultado).toEqual([]);
  });

  it("no devuelve una aprobada anterior a la última integrada, sí la posterior", async () => {
    const base = await crearBase();
    const vieja = await crearAprobada(base, dia(1, 10), dia(1, 11));
    const integrada = await crearAprobada(base, dia(2, 10), dia(2, 11));
    const nueva = await crearAprobada(base, dia(3, 10), dia(3, 11));
    await prismaRaw.pacienteContextoClinico.create({
      data: {
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
        ultimaSesionId: integrada,
      },
    });

    const resultado = await sesionesSinContexto({
      prisma: db,
      desde: DESDE,
      limite: 5,
    });

    expect(resultado.map((r) => r.sesionClinicaId)).toEqual([nueva]);
    expect(resultado.map((r) => r.sesionClinicaId)).not.toContain(vieja);
    expect(resultado[0].numeroSesion).toBe(3);
    expect(resultado[0].contextoActual?.ultimaSesionId).toBe(integrada);
  });

  it("entrega una sola sesión por paciente por llamada, la más antigua", async () => {
    const base = await crearBase();
    const primera = await crearAprobada(base, dia(1, 10), dia(1, 11));
    await crearAprobada(base, dia(2, 10), dia(2, 11));

    const resultado = await sesionesSinContexto({
      prisma: db,
      desde: DESDE,
      limite: 5,
    });

    expect(resultado.map((r) => r.sesionClinicaId)).toEqual([primera]);
  });

  // ─── La regla "está integrada", sola ──────────────────────────────────
  // Es pura y la comparten el batch del worker y la métrica de salud: si las
  // dos no contestaran lo mismo, el monitoreo alertaría para siempre por algo
  // que el worker nunca va a tomar.

  describe("estaIntegrada", () => {
    const enero = (n: number) => new Date(`2026-01-0${n}T12:00:00.000Z`);
    const sesion = { id: "s2", aprobadoEn: enero(2) };

    it("sin contexto, nada está integrado", () => {
      expect(estaIntegrada(sesion, null, null)).toBe(false);
    });

    it("sin ultimaSesionId, nada está integrado", () => {
      expect(estaIntegrada(sesion, { ultimaSesionId: null }, null)).toBe(false);
    });

    it("el contexto que apunta a esta sesión la da por integrada", () => {
      expect(estaIntegrada(sesion, { ultimaSesionId: "s2" }, null)).toBe(true);
    });

    it("una sesión aprobada antes que la última integrada ya está cubierta", () => {
      expect(estaIntegrada(sesion, { ultimaSesionId: "s3" }, enero(3))).toBe(
        true,
      );
    });

    it("una sesión aprobada después que la última integrada falta", () => {
      expect(estaIntegrada(sesion, { ultimaSesionId: "s1" }, enero(1))).toBe(
        false,
      );
    });

    it("si la sesión apuntada ya no existe, no se excluye nada", () => {
      expect(estaIntegrada(sesion, { ultimaSesionId: "borrada" }, null)).toBe(
        false,
      );
    });
  });
});

describe("contarSesionesSinContextoAtrasadas", () => {
  const dia = (n: number, h: number) =>
    new Date(Date.UTC(2026, 0, n, h, 0, 0, 0));
  const CORTE = dia(10, 0);

  async function crearAprobada(base: Base, aprobadoEn: Date) {
    const turnoId = await crearTurno(base, aprobadoEn);
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: base.orgId,
        estado: "aprobado",
        aprobadoEn,
        ...cifrarSesion({ notaSubjetivo: "S" }),
      },
      select: { id: true },
    });
    return sesion.id;
  }

  it("sin sesiones aprobadas no hay nada atrasado", async () => {
    expect(
      await contarSesionesSinContextoAtrasadas({ prisma: db, hasta: CORTE }),
    ).toEqual({ cantidad: 0, saturado: false });
  });

  it("cuenta la aprobada vieja que el hilo nunca integró", async () => {
    const base = await crearBase();
    await crearAprobada(base, dia(1, 10));

    const resultado = await contarSesionesSinContextoAtrasadas({
      prisma: db,
      hasta: CORTE,
    });

    expect(resultado.cantidad).toBe(1);
    expect(resultado.saturado).toBe(false);
  });

  it("no cuenta una aprobada recién aprobada: el worker todavía tiene tiempo", async () => {
    const base = await crearBase();
    await crearAprobada(base, dia(11, 10)); // posterior al corte

    expect(
      (await contarSesionesSinContextoAtrasadas({ prisma: db, hasta: CORTE }))
        .cantidad,
    ).toBe(0);
  });

  it("no cuenta la que el hilo ya integró", async () => {
    const base = await crearBase();
    const id = await crearAprobada(base, dia(1, 10));
    await prismaRaw.pacienteContextoClinico.create({
      data: {
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
        ultimaSesionId: id,
      },
    });

    expect(
      (await contarSesionesSinContextoAtrasadas({ prisma: db, hasta: CORTE }))
        .cantidad,
    ).toBe(0);
  });

  it("cuenta sólo la posterior cuando el hilo quedó a mitad de camino", async () => {
    const base = await crearBase();
    await crearAprobada(base, dia(1, 10));
    const integrada = await crearAprobada(base, dia(2, 10));
    await crearAprobada(base, dia(3, 10));
    await prismaRaw.pacienteContextoClinico.create({
      data: {
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
        ultimaSesionId: integrada,
      },
    });

    expect(
      (await contarSesionesSinContextoAtrasadas({ prisma: db, hasta: CORTE }))
        .cantidad,
    ).toBe(1);
  });

  it("avisa cuando llegó al tope: el número es un piso, no el total", async () => {
    const base = await crearBase();
    await crearAprobada(base, dia(1, 10));
    await crearAprobada(base, dia(2, 10));

    const resultado = await contarSesionesSinContextoAtrasadas({
      prisma: db,
      hasta: CORTE,
      tope: 2,
    });

    expect(resultado).toEqual({ cantidad: 2, saturado: true });
  });
});

/**
 * Integration tests de los casos de uso de sesión clínica — corren contra
 * la DB real de test (misma guarda y limpieza que prisma-encryption.test.ts).
 *
 * R2 y auditoría se pasan como stubs locales que registran llamadas: acá
 * nunca se toca R2 ni la tabla eventos_auditoria.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/casos-uso-sesion.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type { EventoAuditoriaInput } from "@/app/api/_lib/auditoria-pura";
import { aprobarSesion } from "@/app/api/_lib/casos-uso/aprobar-sesion";
import {
  eliminarSesion,
  MENSAJE_AUDIO_NO_BORRADO,
} from "@/app/api/_lib/casos-uso/eliminar-sesion";
import {
  procesarCallback,
  type PayloadCallback,
} from "@/app/api/_lib/casos-uso/procesar-callback";
import { reintentarSesion } from "@/app/api/_lib/casos-uso/reintentar-sesion";
import { ApiError } from "@/app/api/_lib/responses";
import { parseDatosEstructuradosRaw } from "@/app/api/_lib/sesion-clinica";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { cifrarSesion } from "@/lib/prisma-encryption";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

// ─────────────────────────────────────────────────────────────────────────────
// Cliente Prisma de la base de test (conexión y guardas en ./db-test).
// ─────────────────────────────────────────────────────────────────────────────
let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

type Deps = { orgId: string; pacienteId: string; turnoId: string };

async function createDeps(): Promise<Deps> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Test Org ${randomUUID()}` },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Test",
      apellido: "Paciente",
      telefono: "099000000",
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: new Date(),
      tarifaCobrada: 1000,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, pacienteId: paciente.id, turnoId: turno.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stubs de R2 y auditoría: registran llamadas, nunca tocan nada real.
// ─────────────────────────────────────────────────────────────────────────────
function crearStubs(resultadoBorrado = true) {
  const borrados: Array<string | null> = [];
  const eventos: EventoAuditoriaInput[] = [];
  return {
    borrados,
    eventos,
    borrarAudio: async (audioR2Key: string | null): Promise<boolean> => {
      borrados.push(audioR2Key);
      return resultadoBorrado;
    },
    registrarAuditoria: async (evento: EventoAuditoriaInput): Promise<void> => {
      eventos.push(evento);
    },
  };
}

const CLAVE_TEMPORAL = {
  claveCifrado: "clave-base64",
  ivCifrado: "iv-base64",
  guardadoEn: "datosEstructurados",
};

const NOTA_A = {
  subjetivo: "Refiere ansiedad.",
  objetivo: "Tono tenso.",
  analisis: "Alianza estable.",
  plan: "Continuar.",
};

const NOTA_B = {
  subjetivo: "Segunda versión S.",
  objetivo: "Segunda versión O.",
  analisis: "Segunda versión A.",
  plan: "Segunda versión P.",
};

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

// ─────────────────────────────────────────────────────────────────────────────
// aprobarSesion
// ─────────────────────────────────────────────────────────────────────────────
describe("aprobarSesion", () => {
  async function crearEnRevision(opciones: {
    nivelRiesgo?: "ninguno" | "moderado";
    audioR2Key?: string | null;
  } = {}) {
    const deps = await createDeps();
    const datos = {
      temas: ["ansiedad"],
      riesgoDetectado: {
        nivel: opciones.nivelRiesgo ?? "ninguno",
        indicadores: [],
        evidencia: [],
        notaParaTerapeuta: null,
      },
      _audioCifradoTemporal: CLAVE_TEMPORAL,
    };
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "revision",
        audioR2Key:
          opciones.audioR2Key === undefined
            ? "audio/org/ses/tur.enc"
            : opciones.audioR2Key,
        ...cifrarSesion({
          notaSubjetivo: NOTA_A.subjetivo,
          notaObjetivo: NOTA_A.objetivo,
          notaAnalisis: NOTA_A.analisis,
          notaPlan: NOTA_A.plan,
          datosEstructurados: JSON.stringify(datos),
        }),
      },
    });
    return { ...deps, sesionId: sesion.id };
  }

  it("rechaza con 400 si la sesión no está en revisión", async () => {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "procesando",
      },
    });
    const stubs = crearStubs();

    const error = await esperarApiError(
      aprobarSesion({
        prisma: db,
        sesionId: sesion.id,
        organizationId: deps.orgId,
        usuarioId: "u1",
        ...stubs,
      }),
      400,
    );
    expect(error.message).toBe("Solo se pueden aprobar notas en estado revisión");
    expect(stubs.eventos).toHaveLength(0);
  });

  it("rechaza con 400 riesgo moderado sin confirmoRiesgo", async () => {
    const { sesionId, orgId } = await crearEnRevision({ nivelRiesgo: "moderado" });
    const stubs = crearStubs();

    const error = await esperarApiError(
      aprobarSesion({
        prisma: db,
        sesionId,
        organizationId: orgId,
        usuarioId: "u1",
        ...stubs,
      }),
      400,
    );
    expect(error.message).toMatch(/nivel moderado/);

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.estado).toBe("revision");
  });

  it("acepta riesgo moderado con confirmoRiesgo, quita la clave temporal y audita", async () => {
    const { sesionId, orgId } = await crearEnRevision({ nivelRiesgo: "moderado" });
    const stubs = crearStubs(true);

    const resultado = await aprobarSesion({
      prisma: db,
      sesionId,
      organizationId: orgId,
      usuarioId: "u1",
      confirmoRiesgo: true,
      ...stubs,
    });

    expect(resultado.estado).toBe("aprobado");

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.estado).toBe("aprobado");
    expect(fila?.aprobadoEn).not.toBeNull();
    const datos = parseDatosEstructuradosRaw(fila?.datosEstructurados);
    expect(datos).not.toBeNull();
    expect(datos).not.toHaveProperty("_audioCifradoTemporal");
    expect(datos?.temas).toEqual(["ansiedad"]);

    // R2 confirmó el borrado: la key se anula y queda la fecha.
    expect(stubs.borrados).toEqual(["audio/org/ses/tur.enc"]);
    expect(fila?.audioR2Key).toBeNull();
    expect(fila?.audioBorradoEn).not.toBeNull();

    expect(stubs.eventos).toHaveLength(1);
    expect(stubs.eventos[0]?.accion).toBe("sesion.aprobar");
    expect(stubs.eventos[0]?.entidadId).toBe(sesionId);
    expect(stubs.eventos[0]?.detalle).toMatchObject({
      confirmoRiesgo: true,
      nivelRiesgo: "moderado",
      audioBorrado: true,
    });
  });

  it("si R2 no confirma el borrado, audioR2Key NO se anula pero la clave sí se destruye", async () => {
    const { sesionId, orgId } = await crearEnRevision();
    const stubs = crearStubs(false);

    await aprobarSesion({
      prisma: db,
      sesionId,
      organizationId: orgId,
      usuarioId: "u1",
      ...stubs,
    });

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.estado).toBe("aprobado");
    expect(fila?.audioR2Key).toBe("audio/org/ses/tur.enc");
    expect(fila?.audioBorradoEn).toBeNull();
    expect(parseDatosEstructuradosRaw(fila?.datosEstructurados)).not.toHaveProperty(
      "_audioCifradoTemporal",
    );
    expect(stubs.eventos[0]?.detalle).toMatchObject({ audioBorrado: false });
  });

  it("guarda la nota editada y rechaza con 404 una sesión de otra organización", async () => {
    const { sesionId, orgId } = await crearEnRevision();
    const stubs = crearStubs();

    await esperarApiError(
      aprobarSesion({
        prisma: db,
        sesionId,
        organizationId: "otra-org",
        usuarioId: "u1",
        ...stubs,
      }),
      404,
    );

    await aprobarSesion({
      prisma: db,
      sesionId,
      organizationId: orgId,
      usuarioId: "u1",
      notaEditada: NOTA_B,
      notasEdicion: "Corregí el plan.",
      ...stubs,
    });

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.notaPlan).toBe(NOTA_B.plan);
    expect(fila?.notasEdicion).toBe("Corregí el plan.");
    expect(stubs.eventos[0]?.detalle).toMatchObject({ notaEditada: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// procesarCallback
// ─────────────────────────────────────────────────────────────────────────────
describe("procesarCallback", () => {
  async function crearEnProcesando() {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "procesando",
        intentos: 1,
        ...cifrarSesion({
          datosEstructurados: JSON.stringify({
            _audioCifradoTemporal: CLAVE_TEMPORAL,
          }),
        }),
      },
    });
    return { ...deps, sesionId: sesion.id };
  }

  function payloadOk(sesionId: string, nota = NOTA_A): PayloadCallback {
    return {
      sesionClinicaId: sesionId,
      estado: "revision",
      transcripcion: "S0: hola. S1: hola.",
      nota,
      datosEstructurados: { temas: ["trabajo"], intensidadEmocional: 5 },
      modeloASR: "asr-test",
      modeloLLM: "llm-test",
      promptVersion: "v2.1",
    };
  }

  it("no escribe si la sesión no está en procesando (409; estado y nota intactos)", async () => {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "revision",
        ...cifrarSesion({ notaSubjetivo: "original" }),
      },
    });
    const stubs = crearStubs();

    const error = await esperarApiError(
      procesarCallback({
        prisma: db,
        payload: payloadOk(sesion.id, NOTA_B),
        registrarAuditoria: stubs.registrarAuditoria,
      }),
      409,
    );
    expect(error.message).toBe(
      "La sesión no está en procesamiento; callback ignorado",
    );

    const fila = await db.sesionClinica.findUnique({ where: { id: sesion.id } });
    expect(fila?.estado).toBe("revision");
    expect(fila?.notaSubjetivo).toBe("original");
    expect(stubs.eventos).toHaveLength(0);
  });

  it("escribe nota, nota original, re-adjunta la clave y pasa a revision", async () => {
    const { sesionId, orgId } = await crearEnProcesando();
    const stubs = crearStubs();

    await procesarCallback({
      prisma: db,
      payload: payloadOk(sesionId),
      registrarAuditoria: stubs.registrarAuditoria,
    });

    const fila = await db.sesionClinica.findUnique({
      where: { id: sesionId },
      select: {
        estado: true,
        notaSubjetivo: true,
        notaPlan: true,
        notaSoapOriginal: true,
        datosEstructurados: true,
        hablanteTerapeuta: true,
        promptVersion: true,
        transcripcion: true,
      },
    });
    expect(fila?.estado).toBe("revision");
    expect(fila?.notaSubjetivo).toBe(NOTA_A.subjetivo);
    expect(fila?.notaPlan).toBe(NOTA_A.plan);
    expect(fila?.hablanteTerapeuta).toBe("S0");
    expect(fila?.promptVersion).toBe("v2.1");
    expect(fila?.transcripcion).toBe("S0: hola. S1: hola.");
    expect(fila?.notaSoapOriginal).toEqual(NOTA_A);

    const datos = parseDatosEstructuradosRaw(fila?.datosEstructurados);
    expect(datos?.temas).toEqual(["trabajo"]);
    expect(datos?._audioCifradoTemporal).toEqual(CLAVE_TEMPORAL);

    expect(stubs.eventos).toHaveLength(1);
    expect(stubs.eventos[0]?.accion).toBe("sesion.callback");
    expect(stubs.eventos[0]?.organizationId).toBe(orgId);
    expect(stubs.eventos[0]?.detalle).toMatchObject({
      estadoResultado: "revision",
      huboError: false,
    });
  });

  it("un segundo callback no sobreescribe notaSoapOriginal pero sí la nota", async () => {
    const { sesionId } = await crearEnProcesando();
    const stubs = crearStubs();

    await procesarCallback({
      prisma: db,
      payload: payloadOk(sesionId, NOTA_A),
      registrarAuditoria: stubs.registrarAuditoria,
    });

    // Reproceso: la sesión vuelve a "procesando" (columna plana; el cliente
    // crudo alcanza) y llega una segunda nota.
    await prismaRaw.sesionClinica.update({
      where: { id: sesionId },
      data: { estado: "procesando" },
    });

    await procesarCallback({
      prisma: db,
      payload: payloadOk(sesionId, NOTA_B),
      registrarAuditoria: stubs.registrarAuditoria,
    });

    const fila = await db.sesionClinica.findUnique({
      where: { id: sesionId },
      select: { notaSubjetivo: true, notaSoapOriginal: true },
    });
    expect(fila?.notaSubjetivo).toBe(NOTA_B.subjetivo);
    expect(fila?.notaSoapOriginal).toEqual(NOTA_A);
    expect(stubs.eventos).toHaveLength(2);
  });

  it("payload con estado error deja la sesión en error con el mensaje e incrementa intentos", async () => {
    const { sesionId } = await crearEnProcesando();
    const stubs = crearStubs();

    await procesarCallback({
      prisma: db,
      payload: {
        sesionClinicaId: sesionId,
        estado: "error",
        error: "ASR falló",
      },
      registrarAuditoria: stubs.registrarAuditoria,
    });

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.estado).toBe("error");
    expect(fila?.error).toBe("ASR falló");
    expect(fila?.intentos).toBe(2);
    // Sin datosEstructurados en el payload la columna no se toca: la clave
    // temporal sobrevive.
    expect(
      parseDatosEstructuradosRaw(fila?.datosEstructurados)?._audioCifradoTemporal,
    ).toEqual(CLAVE_TEMPORAL);
    expect(stubs.eventos[0]?.detalle).toMatchObject({ huboError: true });
  });

  it("rechaza con 404 una sesión inexistente", async () => {
    const stubs = crearStubs();
    await esperarApiError(
      procesarCallback({
        prisma: db,
        payload: payloadOk("no-existe"),
        registrarAuditoria: stubs.registrarAuditoria,
      }),
      404,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// eliminarSesion
// ─────────────────────────────────────────────────────────────────────────────
describe("eliminarSesion", () => {
  async function crearSesion(opciones: {
    estado: string;
    audioR2Key?: string | null;
    datosEstructurados?: string;
    notaSubjetivo?: string;
  }) {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: opciones.estado,
        audioR2Key: opciones.audioR2Key,
        ...cifrarSesion({
          datosEstructurados: opciones.datosEstructurados,
          notaSubjetivo: opciones.notaSubjetivo,
        }),
      },
    });
    return { ...deps, sesionId: sesion.id };
  }

  it("en revision: descarta la nota, conserva la clave temporal y pasa a error", async () => {
    const { sesionId, orgId } = await crearSesion({
      estado: "revision",
      audioR2Key: "audio/a.enc",
      notaSubjetivo: "nota generada",
      datosEstructurados: JSON.stringify({
        temas: ["x"],
        _audioCifradoTemporal: CLAVE_TEMPORAL,
      }),
    });
    const stubs = crearStubs();

    const resultado = await eliminarSesion({
      prisma: db,
      sesionId,
      organizationId: orgId,
      usuarioId: "u1",
      accion: "descartar",
      ...stubs,
    });

    expect(resultado).toEqual({ tipo: "nota_descartada", audioConservado: true });

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.estado).toBe("error");
    expect(fila?.notaSubjetivo).toBeNull();
    expect(fila?.audioR2Key).toBe("audio/a.enc");
    const datos = parseDatosEstructuradosRaw(fila?.datosEstructurados);
    expect(datos).toEqual({ _audioCifradoTemporal: CLAVE_TEMPORAL });
    expect(fila?.error).toMatch(/se conservan/);

    // El audio no se toca en el descarte.
    expect(stubs.borrados).toHaveLength(0);
    expect(stubs.eventos[0]?.accion).toBe("sesion.descartar");
    expect(stubs.eventos[0]?.detalle).toMatchObject({
      estadoPrevio: "revision",
      audioConservado: true,
    });
  });

  it("en error: borra el audio en R2 y elimina la fila", async () => {
    const { sesionId, orgId } = await crearSesion({
      estado: "error",
      audioR2Key: "audio/b.enc",
    });
    const stubs = crearStubs(true);

    const resultado = await eliminarSesion({
      prisma: db,
      sesionId,
      organizationId: orgId,
      usuarioId: "u1",
      accion: "eliminar",
      ...stubs,
    });

    expect(resultado).toEqual({ tipo: "eliminada" });
    expect(stubs.borrados).toEqual(["audio/b.enc"]);
    expect(await db.sesionClinica.findUnique({ where: { id: sesionId } })).toBeNull();
    expect(stubs.eventos[0]?.accion).toBe("sesion.eliminar");
  });

  it("en error con audio real que R2 no pudo borrar: 409 y la fila se conserva", async () => {
    const { sesionId, orgId } = await crearSesion({
      estado: "error",
      audioR2Key: "audio/c.enc",
    });
    const stubs = crearStubs(false);

    const error = await esperarApiError(
      eliminarSesion({
        prisma: db,
        sesionId,
        organizationId: orgId,
        usuarioId: "u1",
        accion: "eliminar",
        ...stubs,
      }),
      409,
    );
    expect(error.message).toBe(MENSAJE_AUDIO_NO_BORRADO);

    const fila = await db.sesionClinica.findUnique({ where: { id: sesionId } });
    expect(fila?.error).toBe(MENSAJE_AUDIO_NO_BORRADO);
    expect(fila?.audioR2Key).toBe("audio/c.enc");
    expect(stubs.eventos).toHaveLength(0);
  });

  it("grabación abandonada con audio: pasa a error; sin audio: se elimina", async () => {
    const conAudio = await crearSesion({
      estado: "grabando",
      audioR2Key: "audio/d.enc",
    });
    const sinAudio = await crearSesion({ estado: "grabando", audioR2Key: null });
    // Huérfana = más de UMBRAL_HUERFANA_HORAS sin actualización.
    await prismaRaw.$executeRawUnsafe(
      `UPDATE sesiones_clinicas SET "updatedAt" = NOW() - interval '6 hours'
       WHERE id IN ($1, $2)`,
      conAudio.sesionId,
      sinAudio.sesionId,
    );
    const stubs = crearStubs();

    const r1 = await eliminarSesion({
      prisma: db,
      sesionId: conAudio.sesionId,
      organizationId: conAudio.orgId,
      usuarioId: "u1",
      accion: "descartar",
      ...stubs,
    });
    expect(r1).toEqual({ tipo: "grabacion_abandonada_a_error" });
    const fila = await db.sesionClinica.findUnique({
      where: { id: conAudio.sesionId },
    });
    expect(fila?.estado).toBe("error");
    expect(fila?.audioR2Key).toBe("audio/d.enc");

    const r2 = await eliminarSesion({
      prisma: db,
      sesionId: sinAudio.sesionId,
      organizationId: sinAudio.orgId,
      usuarioId: "u1",
      accion: "descartar",
      ...stubs,
    });
    expect(r2).toEqual({ tipo: "eliminada" });
    expect(
      await db.sesionClinica.findUnique({ where: { id: sinAudio.sesionId } }),
    ).toBeNull();

    // Ninguna de las dos ramas toca R2.
    expect(stubs.borrados).toHaveLength(0);
    expect(stubs.eventos.map((e) => e.accion)).toEqual([
      "sesion.descartar",
      "sesion.eliminar",
    ]);
  });

  it("grabando reciente (no huérfana) o aprobado: 409 sin tocar nada", async () => {
    const activa = await crearSesion({ estado: "grabando", audioR2Key: null });
    const aprobada = await crearSesion({ estado: "aprobado" });
    const stubs = crearStubs();

    await esperarApiError(
      eliminarSesion({
        prisma: db,
        sesionId: activa.sesionId,
        organizationId: activa.orgId,
        usuarioId: "u1",
        accion: "descartar",
        ...stubs,
      }),
      409,
    );
    await esperarApiError(
      eliminarSesion({
        prisma: db,
        sesionId: aprobada.sesionId,
        organizationId: aprobada.orgId,
        usuarioId: "u1",
        accion: "descartar",
        ...stubs,
      }),
      409,
    );
    expect(
      await db.sesionClinica.findUnique({ where: { id: activa.sesionId } }),
    ).not.toBeNull();
    expect(stubs.eventos).toHaveLength(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // A5 — la intención tiene que coincidir con el estado.
  //
  // Antes las dos acciones de la pantalla mandaban el mismo request y el
  // estado de la fila decidía cuál ocurría. Entre que la pantalla se dibujó
  // y la usuaria tocó el botón, el estado puede haber cambiado: se
  // confirmaba "se puede deshacer" y se ejecutaba el borrado definitivo.
  //
  // Las cuatro combinaciones de (intención × estado), en una tabla: las dos
  // que corresponden hacen lo suyo, las dos cruzadas dan 409 y no tocan
  // nada.
  // ───────────────────────────────────────────────────────────────────────
  describe("la intención se contrasta con el estado", () => {
    it("descartar sobre una nota en revisión: la descarta", async () => {
      const { sesionId, orgId } = await crearSesion({
        estado: "revision",
        audioR2Key: "audio/e.enc",
        notaSubjetivo: "nota generada",
      });
      const stubs = crearStubs();

      const resultado = await eliminarSesion({
        prisma: db,
        sesionId,
        organizationId: orgId,
        usuarioId: "u1",
        accion: "descartar",
        ...stubs,
      });

      expect(resultado).toEqual({
        tipo: "nota_descartada",
        audioConservado: true,
      });
    });

    it("eliminar sobre una sesión en error: la elimina", async () => {
      const { sesionId, orgId } = await crearSesion({
        estado: "error",
        audioR2Key: "audio/f.enc",
      });
      const stubs = crearStubs(true);

      const resultado = await eliminarSesion({
        prisma: db,
        sesionId,
        organizationId: orgId,
        usuarioId: "u1",
        accion: "eliminar",
        ...stubs,
      });

      expect(resultado).toEqual({ tipo: "eliminada" });
    });

    it("eliminar sobre una nota en revisión: 409 y la nota sigue ahí", async () => {
      // El caso peligroso al revés: quien tocó "Eliminar" en una pantalla
      // vieja no se lleva por delante una nota que mientras tanto llegó.
      const { sesionId, orgId } = await crearSesion({
        estado: "revision",
        audioR2Key: "audio/g.enc",
        notaSubjetivo: "nota generada",
      });
      const stubs = crearStubs(true);

      const error = await esperarApiError(
        eliminarSesion({
          prisma: db,
          sesionId,
          organizationId: orgId,
          usuarioId: "u1",
          accion: "eliminar",
          ...stubs,
        }),
        409,
      );
      expect(error.message).toMatch(/esperando revisión/);

      const fila = await db.sesionClinica.findUnique({
        where: { id: sesionId },
      });
      expect(fila?.estado).toBe("revision");
      expect(fila?.notaSubjetivo).toBe("nota generada");
      // Ni se borró el audio ni se auditó nada.
      expect(stubs.borrados).toHaveLength(0);
      expect(stubs.eventos).toHaveLength(0);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Codex P1 — la comprobación del estado tiene que ser parte de la
    // escritura, no un chequeo anterior.
    //
    // Contrastar la intención contra el estado LEÍDO no alcanza: entre esa
    // lectura y la escritura hay una ventana, y `reintentarSesion` escribe
    // con `{ id, organizationId }` sin mirar el estado, así que gana. Sin el
    // estado en el WHERE de la mutación, el borrado definitivo se llevaba
    // puesta una sesión que en el medio volvió a "procesando" — con su audio.
    //
    // El doble intercala el cambio justo donde ocurre la carrera: después de
    // que el caso de uso leyó la fila y antes de que escriba.
    // ─────────────────────────────────────────────────────────────────────
    function conCambioEnElMedio(sesionId: string, nuevoEstado: string) {
      const real = db;
      const modeloEspiado = new Proxy(real.sesionClinica, {
        get(modelo, prop, receptor) {
          if (prop !== "findFirst") return Reflect.get(modelo, prop, receptor);
          return async (...args: unknown[]) => {
            const fila = await (
              modelo.findFirst as (...a: unknown[]) => Promise<unknown>
            )(...args);
            await real.sesionClinica.updateMany({
              where: { id: sesionId },
              data: { estado: nuevoEstado },
            });
            return fila;
          };
        },
      });

      return new Proxy(real, {
        get(target, prop, receptor) {
          if (prop === "sesionClinica") return modeloEspiado;
          return Reflect.get(target, prop, receptor);
        },
      }) as typeof db;
    }

    it("eliminar mientras un reintento la devuelve a procesando: 409, y el audio NO se borra", async () => {
      const { sesionId, orgId } = await crearSesion({
        estado: "error",
        audioR2Key: "audio/i.enc",
      });
      const stubs = crearStubs(true);

      await esperarApiError(
        eliminarSesion({
          prisma: conCambioEnElMedio(sesionId, "procesando"),
          sesionId,
          organizationId: orgId,
          usuarioId: "u1",
          accion: "eliminar",
          ...stubs,
        }),
        409,
      );

      // Lo que importa: la sesión sigue viva, procesándose, y su audio
      // también. Si el borrado de R2 ocurriera antes de la reserva, el
      // worker levantaría una sesión cuyo audio ya no existe.
      const fila = await db.sesionClinica.findUnique({
        where: { id: sesionId },
      });
      expect(fila?.estado).toBe("procesando");
      expect(fila?.audioR2Key).toBe("audio/i.enc");
      expect(stubs.borrados).toHaveLength(0);
      expect(stubs.eventos).toHaveLength(0);
    });

    it("un reintento que llega mientras se borra el audio no deja la sesión sin blob", async () => {
      // Codex P1 (segunda pasada): la reserva por sí sola no alcanzaba. Un
      // `updateMany` suelto autocommitea y suelta el lock de la fila antes
      // del `await borrarAudio`, así que el reintento podía pasar la sesión a
      // "procesando" mientras el blob se borraba: el DELETE final devolvía 0
      // y contestaba 409, pero el worker quedaba con una sesión encolada sin
      // audio.
      //
      // El doble mete el reintento DENTRO del borrado de R2, que es el único
      // instante en que la ventana existía. Con la operación entera en una
      // transacción, ese UPDATE espera al commit y no llega a ganar.
      const { sesionId, orgId } = await crearSesion({
        estado: "error",
        audioR2Key: "audio/k.enc",
      });

      const borrados: string[] = [];
      let reintentoFallo: unknown = null;

      const resultado = await eliminarSesion({
        prisma: db,
        sesionId,
        organizationId: orgId,
        usuarioId: "u1",
        accion: "eliminar",
        borrarAudio: async (key) => {
          // El reintento REAL, exactamente en el medio: es el que tiene que
          // rebotar contra el token.
          reintentoFallo = await reintentarSesion({
            prisma: db,
            sesionId,
            organizationId: orgId,
            usuarioId: "u2",
            registrarAuditoria: async () => {},
          }).then(
            () => null,
            (error: unknown) => error,
          );
          if (key) borrados.push(key);
          return true;
        },
        registrarAuditoria: async () => {},
      });

      // El reintento no pudo: la sesión se estaba eliminando.
      expect(reintentoFallo).toBeInstanceOf(ApiError);
      expect((reintentoFallo as ApiError).status).toBe(409);

      // Y la eliminación siguió su curso: fila y blob se fueron juntos. La
      // invariante es que nunca queda una sesión viva sin audio.
      expect(resultado).toEqual({ tipo: "eliminada" });
      expect(borrados).toEqual(["audio/k.enc"]);
      expect(
        await db.sesionClinica.findUnique({ where: { id: sesionId } }),
      ).toBeNull();
    });

    it("descartar mientras la nota se aprueba en otra pestaña: 409 y no se pisa", async () => {
      const { sesionId, orgId } = await crearSesion({
        estado: "revision",
        audioR2Key: "audio/j.enc",
        notaSubjetivo: "nota generada",
      });
      const stubs = crearStubs();

      await esperarApiError(
        eliminarSesion({
          prisma: conCambioEnElMedio(sesionId, "aprobado"),
          sesionId,
          organizationId: orgId,
          usuarioId: "u1",
          accion: "descartar",
          ...stubs,
        }),
        409,
      );

      const fila = await db.sesionClinica.findUnique({
        where: { id: sesionId },
      });
      // Sin el estado en el WHERE, el descarte dejaba la sesión aprobada en
      // "error" y le borraba la nota.
      expect(fila?.estado).toBe("aprobado");
      expect(fila?.notaSubjetivo).toBe("nota generada");
      expect(stubs.eventos).toHaveLength(0);
    });

    it("descartar sobre una sesión en error: 409 y no se borra nada", async () => {
      // Éste es EL caso: la usuaria leyó "se puede deshacer, la
      // transcripción y el audio se conservan" y, con la intención
      // implícita, la fila en error hacía el borrado definitivo.
      const { sesionId, orgId } = await crearSesion({
        estado: "error",
        audioR2Key: "audio/h.enc",
      });
      const stubs = crearStubs(true);

      const error = await esperarApiError(
        eliminarSesion({
          prisma: db,
          sesionId,
          organizationId: orgId,
          usuarioId: "u1",
          accion: "descartar",
          ...stubs,
        }),
        409,
      );
      expect(error.message).toMatch(/ya está descartada/);

      const fila = await db.sesionClinica.findUnique({
        where: { id: sesionId },
      });
      expect(fila).not.toBeNull();
      expect(fila?.audioR2Key).toBe("audio/h.enc");
      expect(stubs.borrados).toHaveLength(0);
      expect(stubs.eventos).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reintentarSesion
// ─────────────────────────────────────────────────────────────────────────────
describe("reintentarSesion", () => {
  it("falla con 409 sin audio", async () => {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "error",
        error: "falló",
        intentos: 3,
      },
    });
    const stubs = crearStubs();

    const error = await esperarApiError(
      reintentarSesion({
        prisma: db,
        sesionId: sesion.id,
        organizationId: deps.orgId,
        usuarioId: "u1",
        registrarAuditoria: stubs.registrarAuditoria,
      }),
      409,
    );
    expect(error.message).toMatch(/No hay audio subido/);

    const fila = await db.sesionClinica.findUnique({ where: { id: sesion.id } });
    expect(fila?.estado).toBe("error");
    expect(fila?.intentos).toBe(3);
  });

  it("con audio pasa a procesando, limpia el error, resetea intentos y audita", async () => {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "error",
        error: "falló",
        intentos: 3,
        audioR2Key: "audio/e.enc",
      },
    });
    const stubs = crearStubs();

    const resultado = await reintentarSesion({
      prisma: db,
      sesionId: sesion.id,
      organizationId: deps.orgId,
      usuarioId: "u1",
      registrarAuditoria: stubs.registrarAuditoria,
    });

    expect(resultado.estado).toBe("procesando");
    expect(resultado.intentos).toBe(0);
    expect(resultado.error).toBeNull();

    const fila = await db.sesionClinica.findUnique({ where: { id: sesion.id } });
    expect(fila?.estado).toBe("procesando");
    expect(fila?.intentos).toBe(0);
    expect(fila?.error).toBeNull();

    expect(stubs.eventos).toHaveLength(1);
    expect(stubs.eventos[0]?.accion).toBe("sesion.cambiar_estado");
    expect(stubs.eventos[0]?.detalle).toEqual({
      desde: "error",
      hacia: "procesando",
    });
  });

  it("rechaza con 400 una sesión que no está en error", async () => {
    const deps = await createDeps();
    const sesion = await db.sesionClinica.create({
      data: {
        turnoId: deps.turnoId,
        organizationId: deps.orgId,
        estado: "revision",
        audioR2Key: "audio/f.enc",
      },
    });
    const stubs = crearStubs();

    await esperarApiError(
      reintentarSesion({
        prisma: db,
        sesionId: sesion.id,
        organizationId: deps.orgId,
        usuarioId: "u1",
        registrarAuditoria: stubs.registrarAuditoria,
      }),
      400,
    );
  });
});

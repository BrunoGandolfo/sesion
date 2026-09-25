/**
 * Integración — la grabación sin terminar, contra la base real de test.
 *
 * Una sesión que quedó en `grabando` o `subiendo` (el teléfono murió, se
 * cerró el navegador, se cortó la subida) no tenía salida: se veía
 * "Procesando" para siempre. Este archivo prueba la salida entera:
 *
 *   - Pendientes la muestra: una subida quieta más de 30 min; una grabación
 *     abierta, recién pasado el tope de grabación más 30 min (mientras se
 *     graba nada llega al servidor). Antes, no.
 *   - POST /api/sesion-clinica/[id]/abandonar la descarta: con audio en R2
 *     queda `fallida` + borrado encolado; sin audio, se borra. Todo con su
 *     evento de auditoría en la misma transacción.
 *   - Lo que no está sin terminar (revisión, aprobada) da 409 y no cambia.
 *   - Otra organización recibe 404 y R2 ni se consulta.
 *   - El mantenimiento abandona solo las de más de siete días.
 *
 * R2 es un doble: `existe` lo decide cada caso.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/grabacion-sin-terminar.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { EstadoSesion, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mantenimiento } from "@/app/api/_lib/casos-uso/mantenimiento";
import { pendientesTerapeuta } from "@/app/api/_lib/casos-uso/pendientes-terapeuta";
import {
  ACCION_ABANDONAR,
  ESPERA_BORRADO_SIN_AUDIO_MS,
} from "@/app/api/_lib/casos-uso/sesion/abandonar";
import { SESION_FALLO_LABEL } from "@/lib/glosario";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { CODIGO_GRABACION_ABANDONADA, keyAudio, prefijoAudio } from "@/lib/sesion-clinica/estados";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));
/** Lo que R2 contesta a HeadObject, y a qué keys le preguntaron. */
const r2 = vi.hoisted(() => ({ existe: false, consultadas: [] as string[] }));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => sesionActual.organizationId,
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: sesionActual.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  const existe = async (key: string) => {
    r2.consultadas.push(key);
    return { existe: r2.existe, bytes: r2.existe ? 1024 : null };
  };
  return {
    ...real,
    r2Configurado: () => true,
    existeAudio: existe,
    almacenAudio: { ...real.almacenAudio, existe },
  };
});

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let abandonar!: Handler;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const AHORA = new Date("2026-09-25T15:00:00.000Z");

interface Fixture {
  orgId: string;
  userId: string;
  pacienteId: string;
}

async function crearOrg(): Promise<Fixture> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await prismaRaw.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: "x", nombre: "Mariana", organizationId: org.id },
  });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Ana", apellido: "López", telefono: "+59899000000", tarifa: 1000, organizationId: org.id },
  });
  return { orgId: org.id, userId: user.id, pacienteId: paciente.id };
}

/** Una sesión en `estado`, quieta desde hace `quietaMs`. */
async function crearSesion(f: Fixture, estado: EstadoSesion, quietaMs: number) {
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: new Date(AHORA.getTime() - quietaMs - 10 * MIN),
      estado: "realizado",
      tarifaCobrada: 1000,
      pacienteId: f.pacienteId,
      organizationId: f.orgId,
    },
  });
  const sesion = await prismaRaw.sesionClinica.create({
    data: { turnoId: turno.id, organizationId: f.orgId, estado },
    select: { id: true },
  });
  // `actualizada_en` es @updatedAt: se retrasa por SQL (la sesión de
  // Postgres está en UTC, ver conectarBaseDeTest).
  await prismaRaw.$executeRaw`UPDATE sesiones_clinicas SET actualizada_en = ${new Date(AHORA.getTime() - quietaMs)} WHERE id = ${sesion.id}`;
  return { sesionId: sesion.id, turnoId: turno.id };
}

const leer = (id: string) => prismaRaw.sesionClinica.findUnique({ where: { id } });
const trabajos = () => prismaRaw.trabajo.findMany({ orderBy: { creadoEn: "asc" } });
const eventos = () => prismaRaw.eventoAuditoria.findMany({ where: { accion: ACCION_ABANDONAR } });

function pedirAbandono(sesionId: string, como: Fixture) {
  sesionActual.organizationId = como.orgId;
  sesionActual.userId = como.userId;
  return abandonar(
    new Request(`http://localhost/api/sesion-clinica/${sesionId}/abandonar`, { method: "POST" }),
    { params: Promise.resolve({ id: sesionId }) },
  );
}

async function romperAuditoria() {
  await prismaRaw.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION auditoria_caida() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'auditoria caida'; END;
    $$ LANGUAGE plpgsql;`);
  await prismaRaw.$executeRawUnsafe(`
    CREATE TRIGGER auditoria_caida BEFORE INSERT ON eventos_auditoria
    FOR EACH ROW EXECUTE FUNCTION auditoria_caida();`);
}

async function repararAuditoria() {
  await prismaRaw.$executeRawUnsafe(`DROP TRIGGER IF EXISTS auditoria_caida ON eventos_auditoria;`);
  await prismaRaw.$executeRawUnsafe(`DROP FUNCTION IF EXISTS auditoria_caida();`);
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  // Como en multi-tenant.test.ts: el cliente de test entra por el cache
  // global que lee src/lib/db.ts, ANTES de importar la ruta.
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  abandonar = (await import("@/app/api/sesion-clinica/[id]/abandonar/route")).POST as unknown as Handler;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await repararAuditoria();
  await vaciarTablas(prismaRaw);
  r2.existe = false;
  r2.consultadas = [];
});

afterEach(repararAuditoria);

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("Pendientes: grabación sin terminar", () => {
  it("una subida con 31 min sin actualizar aparece, con el nombre de la paciente; con 29 min, no", async () => {
    const f = await crearOrg();
    const vieja = await crearSesion(f, "subiendo", 31 * MIN);
    await crearSesion(f, "subiendo", 29 * MIN);

    const { grabacionesSinTerminar } = await pendientesTerapeuta({ prisma: db, organizationId: f.orgId, ahora: AHORA });

    expect(grabacionesSinTerminar).toEqual([
      expect.objectContaining({
        sesionId: vieja.sesionId,
        turnoId: vieja.turnoId,
        pacienteId: f.pacienteId,
        pacienteNombre: "Ana López",
      }),
    ]);
  });

  it("una grabación abierta con 31 min NO aparece: mientras se graba nada llega al servidor", async () => {
    const f = await crearOrg();
    await crearSesion(f, "grabando", 31 * MIN);
    await crearSesion(f, "grabando", 179 * MIN);

    const { grabacionesSinTerminar } = await pendientesTerapeuta({ prisma: db, organizationId: f.orgId, ahora: AHORA });

    expect(grabacionesSinTerminar).toEqual([]);
  });

  it("una grabación abierta pasado el tope de grabación más 30 min (181 min) aparece; procesando o fallida, no", async () => {
    const f = await crearOrg();
    const grabando = await crearSesion(f, "grabando", 181 * MIN);
    await crearSesion(f, "procesando", 300 * MIN);
    await crearSesion(f, "fallida", 300 * MIN);

    const { grabacionesSinTerminar } = await pendientesTerapeuta({ prisma: db, organizationId: f.orgId, ahora: AHORA });

    expect(grabacionesSinTerminar?.map((g) => g.sesionId)).toEqual([grabando.sesionId]);
  });

  it("las de otra organización no aparecen", async () => {
    const f = await crearOrg();
    const otra = await crearOrg();
    await crearSesion(otra, "grabando", 2 * DIA);

    const { grabacionesSinTerminar } = await pendientesTerapeuta({ prisma: db, organizationId: f.orgId, ahora: AHORA });

    expect(grabacionesSinTerminar).toEqual([]);
  });
});

describe("POST /api/sesion-clinica/[id]/abandonar", () => {
  it("con audio en R2: queda fallida con grabacion_abandonada, borrado encolado y evento de auditoría", async () => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, "subiendo", 45 * MIN);
    r2.existe = true;

    const respuesta = await pedirAbandono(sesionId, f);

    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).data).toEqual({ resultado: "fallida", conAudio: true });
    expect(r2.consultadas).toEqual([keyAudio(f.orgId, sesionId, 0)]);

    const sesion = await leer(sesionId);
    expect(sesion).toMatchObject({ estado: "fallida", falloCodigo: CODIGO_GRABACION_ABANDONADA });
    // No queda reintentable: el audio se está borrando.
    expect(sesion?.audioEstado).toBe("sin_audio");

    const [trabajo, ...otros] = await trabajos();
    expect(otros).toHaveLength(0);
    expect(trabajo).toMatchObject({
      tipo: "borrar_audio_r2",
      estado: "pendiente",
      sesionId,
      organizationId: f.orgId,
      payload: { prefijo: prefijoAudio(f.orgId, sesionId), indices: [0] },
    });
    expect(trabajo.proximoIntentoEn.getTime()).toBeLessThanOrEqual(Date.now());

    const [evento] = await eventos();
    expect(evento).toMatchObject({
      organizationId: f.orgId,
      actorTipo: "usuario",
      actorId: f.userId,
      entidad: "sesion_clinica",
      entidadId: sesionId,
      detalle: { desde: "subiendo", hacia: "fallida", conAudio: true },
    });
  });

  it("sin audio: la sesión se borra, con un borrado de seguridad diferido y su evento", async () => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, "grabando", 45 * MIN);
    r2.existe = false;
    const antes = Date.now();

    const respuesta = await pedirAbandono(sesionId, f);

    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).data).toEqual({ resultado: "borrada", conAudio: false });
    expect(await leer(sesionId)).toBeNull();

    const [trabajo] = await trabajos();
    expect(trabajo).toMatchObject({ tipo: "borrar_audio_r2", estado: "pendiente", sesionId });
    expect(trabajo.proximoIntentoEn.getTime()).toBeGreaterThanOrEqual(antes + ESPERA_BORRADO_SIN_AUDIO_MS - 1000);

    const [evento] = await eventos();
    expect(evento).toMatchObject({ entidadId: sesionId, detalle: { desde: "grabando", hacia: "borrada", conAudio: false } });
  });

  it.each(["revision", "aprobada"] as const)("sobre una sesión en %s responde 409 y no cambia nada", async (estado) => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, estado, 2 * DIA);
    const antes = await leer(sesionId);

    const respuesta = await pedirAbandono(sesionId, f);

    expect(respuesta.status).toBe(409);
    expect(await leer(sesionId)).toEqual(antes);
    expect(await trabajos()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
    expect(r2.consultadas).toEqual([]);
  });

  it("otra organización recibe 404, no cambia nada y R2 ni se consulta", async () => {
    const f = await crearOrg();
    const intrusa = await crearOrg();
    const { sesionId } = await crearSesion(f, "grabando", 2 * DIA);
    r2.existe = true;

    const respuesta = await pedirAbandono(sesionId, intrusa);

    expect(respuesta.status).toBe(404);
    expect((await leer(sesionId))?.estado).toBe("grabando");
    expect(await trabajos()).toHaveLength(0);
    expect(await eventos()).toHaveLength(0);
    expect(r2.consultadas).toEqual([]);
  });

  it("si la auditoría falla no queda nada: ni la transición, ni el trabajo", async () => {
    const f = await crearOrg();
    const conAudio = await crearSesion(f, "subiendo", 45 * MIN);
    const sinAudio = await crearSesion(f, "grabando", 45 * MIN);
    await romperAuditoria();

    r2.existe = true;
    expect((await pedirAbandono(conAudio.sesionId, f)).status).toBe(500);
    r2.existe = false;
    expect((await pedirAbandono(sinAudio.sesionId, f)).status).toBe(500);

    await repararAuditoria();
    expect((await leer(conAudio.sesionId))?.estado).toBe("subiendo");
    expect((await leer(sinAudio.sesionId))?.estado).toBe("grabando");
    expect(await trabajos()).toHaveLength(0);
  });
});

describe("mantenimiento: red de seguridad a los siete días", () => {
  const almacen = {
    existe: async (key: string) => {
      r2.consultadas.push(key);
      return { existe: r2.existe, bytes: null };
    },
  };

  it("abandona solo las que superan siete días, no las de seis, con actor sistema", async () => {
    const f = await crearOrg();
    const ocho = await crearSesion(f, "subiendo", 8 * DIA);
    const sieteYPico = await crearSesion(f, "grabando", 7 * DIA + 5 * MIN);
    const seis = await crearSesion(f, "grabando", 6 * DIA);
    r2.existe = true;

    const { huerfanas } = await mantenimiento({ prisma: db, ahora: AHORA, almacen });

    expect(huerfanas).toEqual({ fallidas: 2, borradas: 0, errores: 0 });
    expect((await leer(ocho.sesionId))?.estado).toBe("fallida");
    expect((await leer(sieteYPico.sesionId))?.falloCodigo).toBe(CODIGO_GRABACION_ABANDONADA);
    expect((await leer(seis.sesionId))?.estado).toBe("grabando");
    expect(r2.consultadas).not.toContain(keyAudio(f.orgId, seis.sesionId, 0));

    const registrados = await eventos();
    expect(registrados).toHaveLength(2);
    for (const evento of registrados) expect(evento).toMatchObject({ actorTipo: "sistema", actorId: null });
    expect(await trabajos()).toHaveLength(2);
  });

  it("sin audio, la huérfana se borra", async () => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, "grabando", 10 * DIA);
    r2.existe = false;

    const { huerfanas } = await mantenimiento({ prisma: db, ahora: AHORA, almacen });

    expect(huerfanas).toEqual({ fallidas: 0, borradas: 1, errores: 0 });
    expect(await leer(sesionId)).toBeNull();
  });

  it("si R2 no contesta, cuenta el error, no corta la corrida y la sesión queda para mañana", async () => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, "grabando", 10 * DIA);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { huerfanas } = await mantenimiento({
        prisma: db,
        ahora: AHORA,
        almacen: { existe: async () => { throw new Error("R2 caído"); } },
      });
      expect(huerfanas).toEqual({ fallidas: 0, borradas: 0, errores: 1 });
    } finally {
      log.mockRestore();
    }
    expect((await leer(sesionId))?.estado).toBe("grabando");
  });

  it("sin almacén (R2 sin configurar) no toca ninguna", async () => {
    const f = await crearOrg();
    const { sesionId } = await crearSesion(f, "grabando", 10 * DIA);

    const resultado = await mantenimiento({ prisma: db, ahora: AHORA });

    expect(resultado.huerfanas).toBeUndefined();
    expect((await leer(sesionId))?.estado).toBe("grabando");
  });
});

describe("el motivo que se muestra", () => {
  it("SESION_FALLO_LABEL.grabacion_abandonada sigue siendo un motivo legible", () => {
    const texto = SESION_FALLO_LABEL[CODIGO_GRABACION_ABANDONADA];
    expect(texto).toMatch(/^[A-ZÁÉÍÓÚ¿].{10,}\.$/);
    expect(texto).not.toContain("_");
  });
});

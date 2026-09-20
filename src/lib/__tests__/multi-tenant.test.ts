/**
 * Guardián: NINGUNA ruta con id de recurso sirve el recurso de otra
 * organización.
 *
 * Antes este archivo probaba cuatro rutas de sesenta y cinco, escritas a
 * mano, más un caso de `obtenerTurnoParaGrabar` que ya no usaba nadie. Una
 * ruta nueva no entraba sola, así que el aislamiento entre consultorios —lo
 * único que separa la historia clínica de una paciente de la de otra— se
 * probaba donde alguien se acordó de probarlo.
 *
 * Ahora la lista sale del DISCO, igual que en rutas-sin-prisma.test.ts: se
 * recorre src/app/api/**, se toma toda ruta con un segmento dinámico
 * (`[id]`, `[propuestaId]`, `[version]`) y se pide, método por método:
 *
 *   - como la organización DUEÑA: cualquier cosa menos 404. Sin esto el
 *     barrido lo pasaría una ruta rota que contesta 404 siempre.
 *   - como OTRA organización: 404, y ni una fila tocada.
 *
 * El 404 (y no 403) es a propósito: a la organización ajena el recurso no le
 * existe, y la respuesta no le confirma que exista.
 *
 * Una ruta nueva con id entra sola al barrido. Si no filtra por organización,
 * este test se pone rojo el día que se escribe. Si no le aplica —el worker
 * autoriza por ticket, no por sesión— hay que anotarla en EXCEPCIONES con el
 * motivo; la lista es corta a propósito.
 *
 * LAS RUTAS SIN ID NO SE BARREN. No reciben id de recurso, así que no hay
 * nada que pedirles de otra organización: los crons (CRON_SECRET), /health,
 * /version, la reclamación del worker (PROCESSING_SECRET), /csp-report y todo
 * /cuenta (identidad: crear sesión, registrarse, recuperar). Su aislamiento
 * es otro problema y tiene otros tests.
 *
 * CÓMO SE CONECTAN LAS RUTAS A LA BASE DE TEST
 *
 * `src/lib/db.ts` construye el cliente una sola vez y lo cachea en
 * `globalThis.prisma` (el patrón de Next para no abrir una conexión por
 * hot-reload). Acá se aprovecha: se pone el cliente de test en ese global
 * ANTES de importar las rutas, así el `db` que ven es el de la rama de test.
 * Por eso las rutas se importan con `await import(...)` dentro de beforeAll.
 *
 * La sesión se mockea: estos tests no prueban el login, prueban que con una
 * sesión de la organización A no se pueda tocar una fila de la B.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashTermino } from "@/lib/hot-words";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  cifrarConsentimiento,
  cifrarHiloVersion,
  cifrarHotWord,
} from "@/lib/prisma-encryption";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const RAIZ_API = join(process.cwd(), "src", "app", "api");

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const METODOS: Metodo[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

// ─── Excepciones ────────────────────────────────────────────────────────────
// Rutas con id que NO se barren, con el motivo. `metodos` acota la excepción
// a algunos verbos: una misma ruta puede atender a la usuaria por GET y al
// worker por POST, y sólo el segundo queda afuera.

interface Excepcion {
  razon: string;
  metodos?: Metodo[];
}

const EXCEPCIONES: Record<string, Excepcion> = {
  // El worker no trae sesión: autoriza con el ticket de la fila que reclamó
  // (ticket_hash, _lib/tickets.ts). Su aislamiento lo prueban
  // worker-escrituras.test.ts y base-ajena.test.ts: un ticket de otra sesión
  // —o de otra organización— da 401, que es su forma del 404.
  "sesion-clinica/[id]/asr/route.ts": { razon: "worker: autoriza por ticket de la sesión reclamada" },
  "sesion-clinica/[id]/lease/route.ts": { razon: "worker: autoriza por ticket de la sesión reclamada" },
  "sesion-clinica/[id]/resultado/route.ts": { razon: "worker: autoriza por ticket de la sesión reclamada" },
  "trabajos/[id]/resultado/route.ts": { razon: "worker: autoriza por ticket del trabajo reclamado" },
  "sesion-clinica/[id]/transcripcion/route.ts": {
    razon: "worker: el POST guarda la transcripción con el ticket; el GET (la usuaria) SÍ se barre",
    metodos: ["POST"],
  },
};

// ─── Cómo se arma el pedido de cada ruta ────────────────────────────────────
// El id sale del PRIMER segmento de la ruta —el área—, no de una entrada por
// ruta: así una ruta nueva bajo `pacientes/[id]/` queda cubierta sin tocar
// nada acá. Los cuerpos, en cambio, son por ruta: los que validan el body
// antes de mirar la organización contestarían 400 y no probarían nada.

interface Org {
  orgId: string;
  userId: string;
  pacienteId: string;
  turnoId: string;
  hotWordId: string;
  sesionId: string;
  propuestaId: string;
}

/** Qué fila de la organización dueña le corresponde al `[id]` de cada área. */
const RECURSO_DEL_AREA: Record<string, (org: Org) => string> = {
  pacientes: (org) => org.pacienteId,
  turnos: (org) => org.turnoId,
  "hot-words": (org) => org.hotWordId,
  "sesion-clinica": (org) => org.sesionId,
};

/** En los cuerpos que llevan el id de una propuesta, se reemplaza por el de
 *  la organización dueña al armar el pedido. */
const PROPUESTA_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

/** Cuerpos válidos, sólo donde hacen falta para llegar al control de
 *  organización. Sin cuerpo la ruta contestaría 400 y el 404 no probaría
 *  nada. */
const CUERPOS: Record<string, Partial<Record<Metodo, unknown>>> = {
  "hot-words/[id]/route.ts": { PATCH: { activo: false } },
  "pacientes/[id]/route.ts": { PATCH: { nombre: "Intrusa" } },
  "pacientes/[id]/consentimiento/route.ts": {
    POST: { firmaDigital: "data:image/png;base64,AAAA", textoVersion: "2.6" },
  },
  "pacientes/[id]/hilo/versiones/route.ts": { POST: { contenido: contenidoHilo(), basadaEnVersion: 1 } },
  "turnos/[id]/route.ts": { PATCH: { estado: "cancelado" } },
  "turnos/[id]/cobrar/route.ts": {
    POST: { metodo: "efectivo", fecha: "2026-09-01" },
    DELETE: { actualizadoEn: new Date("2026-09-01T14:00:00.000Z").toISOString() },
  },
  "turnos/[id]/cancelar-serie/route.ts": { POST: { desde: "2026-09-01" } },
  "pacientes/[id]/hilo/regenerar/route.ts": { POST: { basadaEnVersion: 1, propuestaId: PROPUESTA_PLACEHOLDER } },
  "pacientes/[id]/hilo/propuestas/[propuestaId]/aceptar/route.ts": { POST: { basadaEnVersion: 1 } },
  "pacientes/[id]/hilo/propuestas/[propuestaId]/rechazar/route.ts": { POST: { basadaEnVersion: 1 } },
  "sesion-clinica/[id]/aprobar/route.ts": { POST: { generacion: 1 } },
  "sesion-clinica/[id]/upload-url/route.ts": { POST: { tamanoBytes: 1024, mime: "audio/webm" } },
  "sesion-clinica/[id]/upload-confirmar/route.ts": {
    POST: { key: "org/sesion/0", duracionAudioSeg: 120 },
  },
};


function contenidoHilo() {
  return {
    hipotesisDiagnostica: null,
    resumenAcumulativo: "Resumen de prueba",
    objetivosTerapeuticos: [],
    intervencionesProbadas: [],
    temasRecurrentes: [],
    riesgosHistoricos: [],
    cambios: [],
  };
}

// ─── El disco ───────────────────────────────────────────────────────────────

function rutasDelDisco(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...rutasDelDisco(ruta));
    else if (nombre === "route.ts") salida.push(ruta);
  }
  return salida.sort();
}

interface RutaConId {
  rel: string;
  /** El path con los segmentos dinámicos ya resueltos se arma por pedido. */
  segmentos: string[];
  metodos: Metodo[];
}

/** Los verbos que exporta un route.ts, leídos del archivo. Se necesitan en
 *  tiempo de COLECCIÓN (para nombrar un caso por ruta y método) y ahí no se
 *  puede importar el módulo: importarlo levanta el cliente Prisma. */
function metodosDe(archivo: string): Metodo[] {
  const fuente = readFileSync(archivo, "utf8");
  return METODOS.filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(fuente),
  );
}

/** Toda ruta del disco con un segmento dinámico. */
function rutasConId(): RutaConId[] {
  return rutasDelDisco(RAIZ_API)
    .map((abs) => ({ abs, rel: relative(RAIZ_API, abs).split("\\").join("/") }))
    .filter(({ rel }) => rel.includes("["))
    .map(({ abs, rel }) => ({
      rel,
      segmentos: rel.split("/").slice(0, -1),
      metodos: metodosDe(abs),
    }));
}

/** ¿Este método de esta ruta está exceptuado? */
function exceptuado(rel: string, metodo: Metodo): boolean {
  const excepcion = EXCEPCIONES[rel];
  return Boolean(excepcion) && (!excepcion.metodos || excepcion.metodos.includes(metodo));
}

// ─── La sesión que ven las rutas ────────────────────────────────────────────

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

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

// R2 no se toca: acá se prueba el aislamiento, no el almacenamiento. Mock
// PARCIAL sobre el módulo real, para que una función nueva de r2.ts no rompa
// el barrido (un mock total obliga a enumerar todos los exports).
vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  const url = "https://bucket.cuenta.r2.cloudflarestorage.com/x";
  return {
    ...real,
    r2Configurado: () => true,
    existeAudio: async () => true,
    borrarAudio: async () => {},
    generarUrlSubida: async (key: string) => ({
      url, key, expiraEn: new Date("2026-12-01T15:00:00.000Z"), headers: {},
    }),
    almacenAudio: {
      existe: async () => true,
      firmarSubida: async (key: string) => ({
        url, key, expiraEn: new Date("2026-12-01T15:00:00.000Z"), headers: {},
      }),
    },
  };
});

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
const rutas: RutaConId[] = rutasConId();
const handlers = new Map<string, Partial<Record<Metodo, Handler>>>();

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");
const MANANA = new Date("2026-12-01T15:00:00.000Z");

async function crearOrg(): Promise<Org> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      nombreProfesional: "Mariana Roldán",
      direccion: "Rivera 2540",
      tarifaDefault: 1000,
    },
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
      telefono: `+5989${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  // Firmada: varias rutas piden la autorización vigente antes de trabajar.
  await db.consentimientoGrabacion.create({
    data: {
      ...cifrarConsentimiento(randomUUID(), {
        textoCompleto: "Autorización de prueba",
        firmaDigital: "data:image/png;base64,AAAA",
      }),
      pacienteId: paciente.id,
      organizationId: org.id,
      firmadoEn: new Date("2026-09-01T14:00:00.000Z"),
      textoVersion: "2.6",
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: MANANA,
      estado: "realizado",
      tarifaCobrada: 1000,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  const sesionId = randomUUID();
  await prismaRaw.sesionClinica.create({
    data: {
      id: sesionId,
      organizationId: org.id,
      turnoId: turno.id,
      estado: "revision",
      audioEstado: "en_r2",
      generacion: 1,
    },
  });
  const termino = `disociación ${randomUUID().slice(0, 8)}`;
  const hotWord = await db.hotWord.create({
    data: {
      organizationId: org.id,
      alcance: "profesional",
      terminoHash: await hashTermino(termino),
      ...cifrarHotWord(randomUUID(), { termino }),
    },
  });
  // El hilo primero: hilo_versiones tiene FK a hilos(paciente_id).
  await prismaRaw.hilo.create({
    data: { pacienteId: paciente.id, organizationId: org.id, ultimaVersion: 1 },
  });
  const propuestaId = randomUUID();
  await db.hiloVersion.create({
    data: {
      pacienteId: paciente.id,
      organizationId: org.id,
      version: 1,
      actor: "ia",
      estado: "propuesta",
      ...cifrarHiloVersion(propuestaId, { contenido: contenidoHilo() }),
    },
  });

  return {
    orgId: org.id,
    userId: user.id,
    pacienteId: paciente.id,
    turnoId: turno.id,
    hotWordId: hotWord.id,
    sesionId,
    propuestaId,
  };
}

/** Los `[param]` de la ruta, resueltos con las filas de `org`. */
function paramsDe(ruta: RutaConId, org: Org): Record<string, string> {
  const area = ruta.segmentos[0];
  const params: Record<string, string> = {};
  for (const segmento of ruta.segmentos) {
    if (!segmento.startsWith("[")) continue;
    const nombre = segmento.slice(1, -1);
    if (nombre === "id") params.id = RECURSO_DEL_AREA[area](org);
    else if (nombre === "propuestaId") params.propuestaId = org.propuestaId;
    else if (nombre === "version") params.version = "1";
    else throw new Error(`Parámetro sin resolver en ${ruta.rel}: ${nombre}`);
  }
  return params;
}

function pedido(ruta: RutaConId, metodo: Metodo, org: Org): Request {
  const cuerpo = CUERPOS[ruta.rel]?.[metodo];
  const json =
    cuerpo === undefined
      ? undefined
      : JSON.stringify(cuerpo).split(PROPUESTA_PLACEHOLDER).join(org.propuestaId);
  return new Request(`http://localhost/api/${ruta.segmentos.join("/")}`, {
    method: metodo,
    ...(json === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: json }),
  });
}

function como(org: Org) {
  sesionActual.organizationId = org.orgId;
  sesionActual.userId = org.userId;
}

async function llamar(ruta: RutaConId, metodo: Metodo, quien: Org, sobre: Org): Promise<number> {
  como(quien);
  const handler = handlers.get(ruta.rel)?.[metodo];
  if (!handler) throw new Error(`Sin handler ${metodo} para ${ruta.rel}`);
  const res = await handler(pedido(ruta, metodo, sobre), {
    params: Promise.resolve(paramsDe(ruta, sobre)),
  });
  return res.status;
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());

  // El cliente de test entra por el cache global que lee src/lib/db.ts. Tiene
  // que pasar ANTES del import de las rutas.
  (globalThis as unknown as { prisma: unknown }).prisma = db;

  for (const ruta of rutas) {
    const modulo = (await import(/* @vite-ignore */ `@/app/api/${ruta.rel.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
    const propios: Partial<Record<Metodo, Handler>> = {};
    for (const m of ruta.metodos) {
      expect(typeof modulo[m], `${ruta.rel}: ${m} no es una función`).toBe("function");
      propios[m] = modulo[m] as Handler;
    }
    handlers.set(ruta.rel, propios);
  }
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
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("aislamiento entre organizaciones — barrido de todas las rutas con id", () => {
  it("encuentra las rutas con id en el disco y todas tienen área conocida", () => {
    expect(rutas.length).toBeGreaterThan(25);
    for (const ruta of rutas) {
      if (EXCEPCIONES[ruta.rel] && !EXCEPCIONES[ruta.rel].metodos) continue;
      expect(
        RECURSO_DEL_AREA[ruta.segmentos[0]],
        `${ruta.rel}: área nueva con id de recurso. Agregá cómo se crea su fila en RECURSO_DEL_AREA (o anotala en EXCEPCIONES con el motivo).`,
      ).toBeDefined();
      expect(ruta.metodos.length, `${ruta.rel}: no exporta ningún método`).toBeGreaterThan(0);
    }
  });

  it("toda excepción sigue existiendo (si la ruta se borró, sacarla de la lista)", () => {
    const existentes = new Set(rutas.map((r) => r.rel));
    for (const rel of Object.keys(EXCEPCIONES)) {
      expect(existentes.has(rel), `${rel} ya no existe: sacarla de EXCEPCIONES`).toBe(true);
    }
  });

  const barridas: [string, Metodo][] = rutas.flatMap((ruta) =>
    ruta.metodos
      .filter((metodo) => !exceptuado(ruta.rel, metodo))
      .map((metodo) => [ruta.rel, metodo] as [string, Metodo]),
  );

  it.each(barridas)("%s %s", async (rel, metodo) => {
    const ruta = rutas.find((r) => r.rel === rel)!;

    const a = await crearOrg();
    const b = await crearOrg();

    // La dueña: cualquier cosa menos 404. Sin esto, una ruta que contesta
    // 404 siempre pasaría el barrido sin aislar nada.
    const propia = await llamar(ruta, metodo, a, a);
    expect(propia, `${rel} ${metodo}: la organización DUEÑA recibió 404`).not.toBe(404);

    // La ajena: 404, y nada de la organización A cambió.
    const antes = await retrato(a);
    const ajena = await llamar(ruta, metodo, b, a);
    expect(ajena, `${rel} ${metodo}: una sesión de OTRA organización no recibió 404`).toBe(404);
    expect(await retrato(a), `${rel} ${metodo}: la organización ajena tocó filas de A`).toEqual(antes);
  });
});

/** Lo que una organización ajena no puede cambiar. */
async function retrato(org: Org) {
  const [paciente, turno, sesion, hotWord, versiones, consentimientos] = await Promise.all([
    prismaRaw.paciente.findUnique({ where: { id: org.pacienteId } }),
    prismaRaw.turno.findUnique({ where: { id: org.turnoId } }),
    prismaRaw.sesionClinica.findUnique({ where: { id: org.sesionId } }),
    prismaRaw.hotWord.findUnique({ where: { id: org.hotWordId } }),
    prismaRaw.hiloVersion.count({ where: { pacienteId: org.pacienteId } }),
    prismaRaw.consentimientoGrabacion.findMany({
      where: { pacienteId: org.pacienteId },
      select: { id: true, revocadoEn: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return { paciente, turno, sesion, hotWord, versiones, consentimientos };
}

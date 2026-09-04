/**
 * Integration tests (bloque B) — corren contra la DB real de test.
 *
 * Requiere DATABASE_URL_TEST apuntando a una rama Neon dedicada con todas
 * las migraciones aplicadas (solo existen las columnas *_encrypted).
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/prisma-encryption.test.ts
 *
 * Diseño bajo prueba: lectura implícita (campos calculados de la extensión
 * `result`, seleccionables y tipados) y escritura explícita vía
 * cifrarSesion / cifrarContexto en `data`.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { __resetKeyCacheForTests, decrypt } from "@/lib/encryption";
import {
  assertConsultaSinCifrados,
  cifrarContexto,
  cifrarSesion,
  withEncryption,
} from "@/lib/prisma-encryption";

// ─────────────────────────────────────────────────────────────────────────────
// Carga de .env.test sin agregar dependencias: parser mínimo, solo si la
// variable no viene ya seteada en el ambiente.
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvTest(): void {
  if (process.env.DATABASE_URL_TEST) return;
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.test"), "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        const value = m[2].replace(/^["']|["']$/g, "");
        process.env[m[1]] = value;
      }
    }
  } catch {
    /* archivo opcional */
  }
}

loadEnvTest();

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    "DATABASE_URL_TEST es obligatorio para los tests de integración de prisma-encryption.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente Prisma, dedicado a esta DB de test. La extensión exige que
// NOTES_ENCRYPTION_KEY esté seteada al construirse, por eso lo hacemos en
// beforeAll (no en el top-level del módulo).
// ─────────────────────────────────────────────────────────────────────────────
let prismaRaw!: PrismaClient;
let db!: ReturnType<typeof withEncryption<PrismaClient>>;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MAGIC_HEX = "454e4331"; // "ENC1"

async function truncateAll(): Promise<void> {
  // CASCADE limpia todo el grafo en una sola sentencia.
  await prismaRaw.$executeRawUnsafe(
    `TRUNCATE TABLE
       "sesiones_clinicas",
       "paciente_contexto_clinico",
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

function leerSesion(id: string) {
  return db.sesionClinica.findUniqueOrThrow({ where: { id } });
}

/** Columna física cruda, para verificar formato del blob. */
async function columnaSesion(id: string, columna: string): Promise<Buffer | null> {
  const rows = await prismaRaw.$queryRawUnsafe<{ blob: Buffer | null }[]>(
    `SELECT ${columna} AS blob FROM sesiones_clinicas WHERE id = $1`,
    id,
  );
  return rows[0]?.blob ?? null;
}

function prefijoHex(blob: Buffer | null | undefined): string | null {
  return blob ? blob.subarray(0, 4).toString("hex") : null;
}

/**
 * Igualdad exacta de una fila con campos calculados. Prisma agrega a esas
 * filas una propiedad Symbol(nodejs.util.inspect.custom) que `toEqual`
 * cuenta; por eso se comparan valores (toMatchObject) y claves (Object.keys
 * ignora símbolos) por separado.
 */
function esperarFilaExacta(
  fila: unknown,
  esperado: Record<string, unknown>,
): void {
  expect(fila).toMatchObject(esperado);
  expect(Object.keys(fila ?? {}).sort()).toEqual(Object.keys(esperado).sort());
}

beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  prismaRaw = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_TEST } },
  });
  db = withEncryption(prismaRaw);
});

beforeEach(async () => {
  // Aseguramos que la clave esté siempre disponible antes de cada test
  // (otros archivos de test pueden mutar la env vía afterEach hooks).
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

// ─────────────────────────────────────────────────────────────────────────────
// cifrarSesion / cifrarContexto — puros (formato del blob y semántica de null)
// ─────────────────────────────────────────────────────────────────────────────

describe("cifrarSesion — columnas que produce", () => {
  it("1. sin campos, o con campos undefined, no toca ninguna columna", () => {
    expect(cifrarSesion({})).toEqual({});
    expect(
      cifrarSesion({
        transcripcion: undefined,
        notaSubjetivo: undefined,
        notaSoapOriginal: undefined,
        datosEstructurados: undefined,
        notasEdicion: undefined,
      }),
    ).toEqual({});
  });

  it("2. null cifra como null: { notaSubjetivo: null } → notaSoapEncrypted: null", () => {
    expect(cifrarSesion({ notaSubjetivo: null })).toEqual({
      notaSoapEncrypted: null,
    });
    expect(cifrarSesion({ transcripcion: null })).toEqual({
      transcripcionEncrypted: null,
    });
    expect(cifrarSesion({ notaSoapOriginal: null })).toEqual({
      notaSoapOriginalEncrypted: null,
    });
    expect(cifrarSesion({ datosEstructurados: null })).toEqual({
      datosEstructuradosEncrypted: null,
    });
    expect(cifrarSesion({ notasEdicion: null })).toEqual({
      notasEdicionEncrypted: null,
    });
  });

  it("3. el blob tiene prefijo ENC1 y el texto plano es byte a byte el de siempre", () => {
    const columnas = cifrarSesion({
      transcripcion: "T",
      notaSubjetivo: "S",
      notaPlan: "P",
      notaSoapOriginal: { subjetivo: "s0", objetivo: null, analisis: "a0", plan: null },
      datosEstructurados: { temas: ["x"] },
      notasEdicion: "E",
    });
    expect(prefijoHex(columnas.transcripcionEncrypted)).toBe(MAGIC_HEX);
    expect(decrypt(columnas.transcripcionEncrypted!)).toBe("T");
    // Las secciones no enviadas quedan null, en el orden fijo del bundle.
    expect(decrypt(columnas.notaSoapEncrypted!)).toBe(
      '{"subjetivo":"S","objetivo":null,"analisis":null,"plan":"P"}',
    );
    expect(decrypt(columnas.notaSoapOriginalEncrypted!)).toBe(
      '{"subjetivo":"s0","objetivo":null,"analisis":"a0","plan":null}',
    );
    expect(decrypt(columnas.datosEstructuradosEncrypted!)).toBe('{"temas":["x"]}');
    expect(decrypt(columnas.notasEdicionEncrypted!)).toBe("E");
  });

  it("4. datosEstructurados como string JSON se cifra tal cual; SOAP todo null → columna null", () => {
    const columnas = cifrarSesion({
      datosEstructurados: '{"a":1}',
      notaSubjetivo: null,
      notaObjetivo: null,
      notaAnalisis: null,
      notaPlan: null,
    });
    expect(decrypt(columnas.datosEstructuradosEncrypted!)).toBe('{"a":1}');
    expect(columnas.notaSoapEncrypted).toBeNull();
  });

  it("5. cifrarContexto: texto, JSON de riesgos y null", () => {
    const columnas = cifrarContexto({
      hipotesisDiagnostica: "H",
      resumenAcumulativo: null,
      riesgosHistoricos: [{ sesionId: "s", fecha: "f", flag: "x" }],
    });
    expect(decrypt(columnas.hipotesisDiagnosticaEncrypted!)).toBe("H");
    expect(columnas.resumenAcumulativoEncrypted).toBeNull();
    expect(decrypt(columnas.riesgosHistoricosEncrypted!)).toBe(
      '[{"sesionId":"s","fecha":"f","flag":"x"}]',
    );
    expect(cifrarContexto({})).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Roundtrips contra la base
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — roundtrips básicos", () => {
  it("6. transcripcion: roundtrip + columna física empieza con magic ENC1", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ transcripcion: "Paciente expresó tristeza al inicio." }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.transcripcion).toBe("Paciente expresó tristeza al inicio.");

    const blob = await columnaSesion(created.id, "transcripcion_encrypted");
    expect(blob).toBeTruthy();
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(prefijoHex(blob)).toBe(MAGIC_HEX);
  });

  it("7. SOAP completo: 4 campos cifrados van y vuelven", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({
          notaSubjetivo: "Refiere ansiedad nocturna.",
          notaObjetivo: "Postura tensa, contacto visual reducido.",
          notaAnalisis: "Patrón de hipervigilancia.",
          notaPlan: "Próxima sesión: ejercicio de grounding.",
        }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.notaSubjetivo).toBe("Refiere ansiedad nocturna.");
    expect(read.notaObjetivo).toBe("Postura tensa, contacto visual reducido.");
    expect(read.notaAnalisis).toBe("Patrón de hipervigilancia.");
    expect(read.notaPlan).toBe("Próxima sesión: ejercicio de grounding.");
  });

  it("8. SOAP parcial: solo S y A, los otros null", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({
          notaSubjetivo: "Sólo subjetivo presente.",
          notaAnalisis: "Sólo análisis presente.",
        }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.notaSubjetivo).toBe("Sólo subjetivo presente.");
    expect(read.notaAnalisis).toBe("Sólo análisis presente.");
    expect(read.notaObjetivo).toBeNull();
    expect(read.notaPlan).toBeNull();
  });

  it("9. datosEstructurados como objeto: roundtrip", async () => {
    const { turnoId, orgId } = await createDeps();
    const payload = {
      temas: ["ansiedad", "trabajo"],
      emociones: { primaria: "miedo", intensidad: 7 },
      alertas: [],
    };
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ datosEstructurados: payload }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.datosEstructurados).toEqual(payload);
  });

  it("10. datosEstructurados como string JSON: se parsea al leer", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ datosEstructurados: '{"temas":["alianza"],"score":0.92}' }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.datosEstructurados).toEqual({ temas: ["alianza"], score: 0.92 });
  });

  it("11. notasEdicion: roundtrip de string", async () => {
    const { turnoId, orgId } = await createDeps();
    const texto = "Mariana corrigió 'paciento' → 'paciente' en línea 12.";
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ notasEdicion: texto }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.notasEdicion).toBe(texto);
  });

  it("12. notaSoapOriginal: roundtrip como objeto, en su propia columna", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({
          notaSoapOriginal: {
            subjetivo: "S original",
            objetivo: "O original",
            analisis: null,
            plan: "P original",
          },
        }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.notaSoapOriginal).toEqual({
      subjetivo: "S original",
      objetivo: "O original",
      analisis: null,
      plan: "P original",
    });

    expect(
      prefijoHex(await columnaSesion(created.id, "nota_soap_original_encrypted")),
    ).toBe(MAGIC_HEX);
    expect(await columnaSesion(created.id, "nota_soap_encrypted")).toBeNull();
  });

  it("13. notaSoapOriginal: ausente y null explícito devuelven null; select parcial trae solo lo pedido", async () => {
    const { turnoId, orgId } = await createDeps();
    const sinNota = await db.sesionClinica.create({
      data: { turnoId, organizationId: orgId },
    });
    expect((await leerSesion(sinNota.id)).notaSoapOriginal).toBeNull();

    const actualizada = await db.sesionClinica.update({
      where: { id: sinNota.id },
      data: cifrarSesion({ notaSoapOriginal: null }),
    });
    expect(actualizada.notaSoapOriginal).toBeNull();

    // Al seleccionar el campo lógico, Prisma trae la columna cifrada sola y
    // no la expone en el resultado.
    const parcial = await db.sesionClinica.findUniqueOrThrow({
      where: { id: sinNota.id },
      select: { id: true, notaSoapOriginal: true },
    });
    esperarFilaExacta(parcial, { id: sinNota.id, notaSoapOriginal: null });
  });
});

describe("prisma-encryption — null, undefined y select", () => {
  it("14. crear sin campos cifrados: todo vuelve null", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: { turnoId, organizationId: orgId },
    });

    const read = await leerSesion(created.id);
    expect(read.transcripcion).toBeNull();
    expect(read.notaSubjetivo).toBeNull();
    expect(read.notaObjetivo).toBeNull();
    expect(read.notaAnalisis).toBeNull();
    expect(read.notaPlan).toBeNull();
    expect(read.datosEstructurados).toBeNull();
    expect(read.notasEdicion).toBeNull();
    expect(read.notaSoapOriginal).toBeNull();
  });

  it("15. select con campos lógicos: vienen descifrados y sin las columnas cifradas", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ transcripcion: "T", notaAnalisis: "A", notasEdicion: "E" }),
      },
    });

    const parcial = await db.sesionClinica.findUniqueOrThrow({
      where: { id: created.id },
      select: { id: true, transcripcion: true, notaAnalisis: true, notaPlan: true },
    });
    esperarFilaExacta(parcial, {
      id: created.id,
      transcripcion: "T",
      notaAnalisis: "A",
      notaPlan: null,
    });
  });

  it("16. campos calculados también en relaciones anidadas", async () => {
    const { turnoId, orgId } = await createDeps();
    await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ notaPlan: "Plan anidado" }),
      },
    });

    const turno = await db.turno.findUniqueOrThrow({
      where: { id: turnoId },
      select: { sesionClinica: { select: { notaPlan: true } } },
    });
    expect(turno.sesionClinica?.notaPlan).toBe("Plan anidado");
  });
});

describe("prisma-encryption — unicode", () => {
  it("17. unicode: emojis, acentos, ñ sobreviven", async () => {
    const { turnoId, orgId } = await createDeps();
    const text =
      "Mariana atendió en Caaguazú: ¿está bien? 👩‍⚕️🇺🇾 — niño/a — paréntesis (test).";
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ transcripcion: text, notaSubjetivo: text, notasEdicion: text }),
      },
    });

    const read = await leerSesion(created.id);
    expect(read.transcripcion).toBe(text);
    expect(read.notaSubjetivo).toBe(text);
    expect(read.notasEdicion).toBe(text);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guarda: nada cifrado en WHERE / ORDER BY
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — defensa contra WHERE/ORDER BY", () => {
  // Los campos lógicos no existen en los tipos de where/orderBy (TS ya los
  // rechaza), así que la guarda se prueba directo sobre los args.
  it("18. WHERE sobre campo lógico es rechazado", () => {
    expect(() =>
      assertConsultaSinCifrados("SesionClinica", {
        where: { transcripcion: "algo" },
      }),
    ).toThrow(/encrypted field/i);
    expect(() =>
      assertConsultaSinCifrados("PacienteContextoClinico", {
        where: { hipotesisDiagnostica: "algo" },
      }),
    ).toThrow(/encrypted field/i);
  });

  it("19. WHERE recursivo (AND / OR / NOT) sobre campo lógico es rechazado", () => {
    expect(() =>
      assertConsultaSinCifrados("SesionClinica", {
        where: { AND: [{ estado: "x" }, { OR: [{ notaPlan: "algo" }] }] },
      }),
    ).toThrow(/encrypted field/i);
    expect(() =>
      assertConsultaSinCifrados("SesionClinica", {
        where: { NOT: { datosEstructurados: null } },
      }),
    ).toThrow(/encrypted field/i);
  });

  it("20. ORDER BY sobre campo lógico es rechazado", () => {
    expect(() =>
      assertConsultaSinCifrados("SesionClinica", {
        orderBy: [{ createdAt: "asc" }, { transcripcion: "asc" }],
      }),
    ).toThrow(/encrypted field/i);
  });

  it("21. columnas cifradas tampoco: la guarda corre dentro del cliente", async () => {
    await expect(
      db.sesionClinica.findMany({
        where: { transcripcionEncrypted: Buffer.alloc(0) },
      }),
    ).rejects.toThrow(/encrypted field/i);
    await expect(
      db.sesionClinica.findMany({ orderBy: { notaSoapEncrypted: "asc" } }),
    ).rejects.toThrow(/encrypted field/i);
    await expect(
      db.pacienteContextoClinico.count({
        where: { riesgosHistoricosEncrypted: null },
      }),
    ).rejects.toThrow(/encrypted field/i);
  });

  it("22. una consulta limpia pasa", () => {
    expect(() =>
      assertConsultaSinCifrados("SesionClinica", {
        where: { estado: "revision", AND: [{ intentos: 0 }] },
        orderBy: { createdAt: "desc" },
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Datos corruptos
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — datos corruptos", () => {
  async function insertarBlobCrudo(blob: Buffer): Promise<string> {
    const { turnoId, orgId } = await createDeps();
    const id = `raw_${randomUUID().replace(/-/g, "")}`;
    await prismaRaw.$executeRawUnsafe(
      `INSERT INTO sesiones_clinicas
         ("id", "turnoId", "organizationId", "estado", "intentos",
          "transcripcion_encrypted",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'pendiente', 0, $4, NOW(), NOW())`,
      id,
      turnoId,
      orgId,
      blob,
    );
    return id;
  }

  // El campo calculado puede evaluarse al construir la fila o al acceder;
  // en ambos casos la lectura completa (consulta + acceso) falla.
  async function leerTranscripcion(id: string): Promise<string | null> {
    const fila = await db.sesionClinica.findUniqueOrThrow({ where: { id } });
    return fila.transcripcion;
  }

  it("23. buffer cifrado corrupto (con magic prefix válido) tira error de descifrado", async () => {
    const id = await insertarBlobCrudo(
      Buffer.concat([
        Buffer.from([0x45, 0x4e, 0x43, 0x31]), // ENC1
        Buffer.alloc(12, 0x00), // IV bogus
        Buffer.alloc(16, 0x00), // authTag bogus
        Buffer.from("garbage payload"),
      ]),
    );
    await expect(leerTranscripcion(id)).rejects.toThrow(
      /authentication tag|decrypt/i,
    );
  });

  it("24. blob sin prefijo ENC1 es dato corrupto: no hay columna en claro a la que caer", async () => {
    const id = await insertarBlobCrudo(Buffer.from("texto plano sin cifrar", "utf8"));
    await expect(leerTranscripcion(id)).rejects.toThrow(/magic prefix|decrypt/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operaciones masivas y upsert
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — operaciones masivas y upsert", () => {
  it("25. createMany: 3 registros, todos cifran y descifran", async () => {
    const a = await createDeps();
    const b = await createDeps();
    const c = await createDeps();
    const ids = [`m_${randomUUID()}`, `m_${randomUUID()}`, `m_${randomUUID()}`];

    const { count } = await db.sesionClinica.createMany({
      data: [
        {
          id: ids[0],
          turnoId: a.turnoId,
          organizationId: a.orgId,
          ...cifrarSesion({ transcripcion: "uno", notaSubjetivo: "S1" }),
        },
        {
          id: ids[1],
          turnoId: b.turnoId,
          organizationId: b.orgId,
          ...cifrarSesion({ transcripcion: "dos", notaPlan: "P2" }),
        },
        {
          id: ids[2],
          turnoId: c.turnoId,
          organizationId: c.orgId,
          ...cifrarSesion({ notasEdicion: "edición tres" }),
        },
      ],
    });
    expect(count).toBe(3);

    const r0 = await leerSesion(ids[0]);
    const r1 = await leerSesion(ids[1]);
    const r2 = await leerSesion(ids[2]);
    expect(r0.transcripcion).toBe("uno");
    expect(r0.notaSubjetivo).toBe("S1");
    expect(r1.transcripcion).toBe("dos");
    expect(r1.notaPlan).toBe("P2");
    expect(r2.notasEdicion).toBe("edición tres");
  });

  it("26. createManyAndReturn: las filas devueltas vienen descifradas", async () => {
    const a = await createDeps();
    const b = await createDeps();

    const devueltas = await db.sesionClinica.createManyAndReturn({
      data: [
        {
          turnoId: a.turnoId,
          organizationId: a.orgId,
          ...cifrarSesion({
            transcripcion: "primera",
            datosEstructurados: { temas: ["uno"] },
          }),
        },
        {
          turnoId: b.turnoId,
          organizationId: b.orgId,
          ...cifrarSesion({ notaAnalisis: "análisis dos" }),
        },
      ],
      select: { turnoId: true, transcripcion: true, datosEstructurados: true, notaAnalisis: true },
    });
    expect(devueltas).toHaveLength(2);

    const f0 = devueltas.find((f) => f.turnoId === a.turnoId);
    const f1 = devueltas.find((f) => f.turnoId === b.turnoId);
    esperarFilaExacta(f0, {
      turnoId: a.turnoId,
      transcripcion: "primera",
      datosEstructurados: { temas: ["uno"] },
      notaAnalisis: null,
    });
    esperarFilaExacta(f1, {
      turnoId: b.turnoId,
      transcripcion: null,
      datosEstructurados: null,
      notaAnalisis: "análisis dos",
    });
  });

  it("27. upsert: crea, después actualiza transcripcion, lee el nuevo valor", async () => {
    const { turnoId, orgId } = await createDeps();

    await db.sesionClinica.upsert({
      where: { turnoId },
      create: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ transcripcion: "primera versión" }),
      },
      update: cifrarSesion({ transcripcion: "primera versión" }),
    });

    await db.sesionClinica.upsert({
      where: { turnoId },
      create: {
        turnoId,
        organizationId: orgId,
        ...cifrarSesion({ transcripcion: "no debería usarse" }),
      },
      update: cifrarSesion({ transcripcion: "versión actualizada" }),
    });

    const read = await db.sesionClinica.findUniqueOrThrow({ where: { turnoId } });
    expect(read.transcripcion).toBe("versión actualizada");

    // Y la columna física sigue siendo un blob ENC1 fresco (con IV nuevo).
    expect(prefijoHex(await columnaSesion(read.id, "transcripcion_encrypted"))).toBe(
      MAGIC_HEX,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PacienteContextoClinico (Golden Thread)
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — PacienteContextoClinico", () => {
  it("28. roundtrip de hipotesisDiagnostica, resumenAcumulativo y riesgosHistoricos", async () => {
    const { orgId, pacienteId } = await createDeps();
    const riesgos = [
      {
        sesionId: "ses_1",
        fecha: "2026-09-01T10:00:00.000Z",
        flag: "ideacionSuicida",
        detalle: "Mención pasiva, sin plan.",
      },
    ];
    await db.pacienteContextoClinico.create({
      data: {
        pacienteId,
        organizationId: orgId,
        ...cifrarContexto({
          hipotesisDiagnostica: "Trastorno de ansiedad generalizada (hipótesis).",
          resumenAcumulativo: "Tres sesiones; foco en regulación emocional.",
          riesgosHistoricos: riesgos,
        }),
      },
    });

    const read = await db.pacienteContextoClinico.findUniqueOrThrow({
      where: { pacienteId },
    });
    expect(read.hipotesisDiagnostica).toBe(
      "Trastorno de ansiedad generalizada (hipótesis).",
    );
    expect(read.resumenAcumulativo).toBe(
      "Tres sesiones; foco en regulación emocional.",
    );
    expect(read.riesgosHistoricos).toEqual(riesgos);

    // Columnas físicas: las tres cifradas con prefijo ENC1.
    const rows = await prismaRaw.$queryRaw<
      { h: Buffer | null; r: Buffer | null; g: Buffer | null }[]
    >`
      SELECT hipotesis_diagnostica_encrypted AS h,
             resumen_acumulativo_encrypted AS r,
             riesgos_historicos_encrypted AS g
      FROM paciente_contexto_clinico
      WHERE paciente_id = ${pacienteId}
    `;
    for (const blob of [rows[0]?.h, rows[0]?.r, rows[0]?.g]) {
      expect(prefijoHex(blob)).toBe(MAGIC_HEX);
    }
  });

  it("29. null, select parcial y borrado con null", async () => {
    const { orgId, pacienteId } = await createDeps();
    await db.pacienteContextoClinico.create({
      data: {
        pacienteId,
        organizationId: orgId,
        ...cifrarContexto({
          riesgosHistoricos: [{ sesionId: "s", fecha: "f", flag: "x" }],
        }),
      },
    });

    const parcial = await db.pacienteContextoClinico.findUniqueOrThrow({
      where: { pacienteId },
      select: { pacienteId: true, hipotesisDiagnostica: true, riesgosHistoricos: true },
    });
    esperarFilaExacta(parcial, {
      pacienteId,
      hipotesisDiagnostica: null,
      riesgosHistoricos: [{ sesionId: "s", fecha: "f", flag: "x" }],
    });

    const actualizado = await db.pacienteContextoClinico.update({
      where: { pacienteId },
      data: { version: 2, ...cifrarContexto({ riesgosHistoricos: null }) },
    });
    expect(actualizado.riesgosHistoricos).toBeNull();
    expect(actualizado.version).toBe(2);
  });
});

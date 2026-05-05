/**
 * Integration tests (bloque B) — corren contra la DB real de test.
 *
 * Requiere DATABASE_URL_TEST apuntando a una rama Neon dedicada con todas
 * las migraciones aplicadas (incluido encrypt_notas_clinicas y
 * add_notas_edicion_encrypted).
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/prisma-encryption.test.ts
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

import { __resetKeyCacheForTests } from "@/lib/encryption";
import { withEncryption } from "@/lib/prisma-encryption";

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

async function truncateAll(): Promise<void> {
  // CASCADE limpia todo el grafo en una sola sentencia.
  await prismaRaw.$executeRawUnsafe(
    `TRUNCATE TABLE
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
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("prisma-encryption — roundtrips básicos", () => {
  it("1. transcripcion: roundtrip + columna física empieza con magic ENC1", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        transcripcion: "Paciente expresó tristeza al inicio.",
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.transcripcion).toBe("Paciente expresó tristeza al inicio.");

    // Verificación binaria contra la columna física.
    const rows = await prismaRaw.$queryRaw<{ blob: Buffer | null }[]>`
      SELECT transcripcion_encrypted AS blob
      FROM sesiones_clinicas
      WHERE id = ${created.id}
    `;
    const blob = rows[0]?.blob;
    expect(blob).toBeTruthy();
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(blob!.subarray(0, 4).toString("hex")).toBe("454e4331"); // "ENC1"
  });

  it("2. SOAP completo: 4 campos cifrados van y vuelven", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        notaSubjetivo: "Refiere ansiedad nocturna.",
        notaObjetivo: "Postura tensa, contacto visual reducido.",
        notaAnalisis: "Patrón de hipervigilancia.",
        notaPlan: "Próxima sesión: ejercicio de grounding.",
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.notaSubjetivo).toBe("Refiere ansiedad nocturna.");
    expect(read?.notaObjetivo).toBe("Postura tensa, contacto visual reducido.");
    expect(read?.notaAnalisis).toBe("Patrón de hipervigilancia.");
    expect(read?.notaPlan).toBe("Próxima sesión: ejercicio de grounding.");
  });

  it("3. SOAP parcial: solo S y A, los otros null", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        notaSubjetivo: "Sólo subjetivo presente.",
        notaAnalisis: "Sólo análisis presente.",
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.notaSubjetivo).toBe("Sólo subjetivo presente.");
    expect(read?.notaAnalisis).toBe("Sólo análisis presente.");
    expect(read?.notaObjetivo).toBeNull();
    expect(read?.notaPlan).toBeNull();
  });

  it("4. datosEstructurados como objeto: roundtrip", async () => {
    const { turnoId, orgId } = await createDeps();
    const payload = {
      temas: ["ansiedad", "trabajo"],
      emociones: { primaria: "miedo", intensidad: 7 },
      alertas: [],
    };
    // El extension acepta objeto o array y hace JSON.stringify por dentro.
    // Casteamos porque el tipo Prisma del field legacy es String?.
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        datosEstructurados: payload as unknown as string,
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.datosEstructurados).toEqual(payload);
  });

  it("5. datosEstructurados como string JSON: se parsea al leer", async () => {
    const { turnoId, orgId } = await createDeps();
    const jsonStr = '{"temas":["alianza"],"score":0.92}';
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        datosEstructurados: jsonStr,
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    // El extension lo pasó tal cual a encrypt() y al leer aplica JSON.parse.
    expect(read?.datosEstructurados).toEqual({
      temas: ["alianza"],
      score: 0.92,
    });
  });

  it("6. notasEdicion: roundtrip de string", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        notasEdicion: "Mariana corrigió 'paciento' → 'paciente' en línea 12.",
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.notasEdicion).toBe(
      "Mariana corrigió 'paciento' → 'paciente' en línea 12.",
    );
  });
});

describe("prisma-encryption — null y undefined", () => {
  it("7. null handling: crear sin campos cifrados, todo vuelve null", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: { turnoId, organizationId: orgId },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read).not.toBeNull();
    expect(read?.transcripcion).toBeNull();
    expect(read?.notaSubjetivo).toBeNull();
    expect(read?.notaObjetivo).toBeNull();
    expect(read?.notaAnalisis).toBeNull();
    expect(read?.notaPlan).toBeNull();
    expect(read?.datosEstructurados).toBeNull();
    expect(read?.notasEdicion).toBeNull();
  });

  it("8. undefined no-op: campos undefined no rompen", async () => {
    const { turnoId, orgId } = await createDeps();
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        transcripcion: undefined,
        notaSubjetivo: undefined,
        notaObjetivo: undefined,
        notaAnalisis: undefined,
        notaPlan: undefined,
        datosEstructurados: undefined,
        notasEdicion: undefined,
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.transcripcion).toBeNull();
    expect(read?.notaSubjetivo).toBeNull();
    expect(read?.datosEstructurados).toBeNull();
    expect(read?.notasEdicion).toBeNull();
  });
});

describe("prisma-encryption — unicode", () => {
  it("9. unicode: emojis, acentos, ñ sobreviven", async () => {
    const { turnoId, orgId } = await createDeps();
    const text =
      "Mariana atendió en Caaguazú: ¿está bien? 👩‍⚕️🇺🇾 — niño/a — paréntesis (test).";
    const created = await db.sesionClinica.create({
      data: {
        turnoId,
        organizationId: orgId,
        transcripcion: text,
        notaSubjetivo: text,
        notasEdicion: text,
      },
    });

    const read = await db.sesionClinica.findUnique({
      where: { id: created.id },
    });
    expect(read?.transcripcion).toBe(text);
    expect(read?.notaSubjetivo).toBe(text);
    expect(read?.notasEdicion).toBe(text);
  });
});

describe("prisma-encryption — defensa contra WHERE/ORDER BY", () => {
  it("10. WHERE sobre campo cifrado es rechazado", async () => {
    await expect(
      db.sesionClinica.findMany({
        where: { transcripcion: "algo" },
      }),
    ).rejects.toThrow(/encrypted field/i);
  });

  it("11. WHERE recursivo (AND) sobre campo cifrado es rechazado", async () => {
    await expect(
      db.sesionClinica.findMany({
        where: { AND: [{ transcripcion: "algo" }] },
      }),
    ).rejects.toThrow(/encrypted field/i);
  });

  it("12. ORDER BY sobre campo cifrado es rechazado", async () => {
    await expect(
      db.sesionClinica.findMany({
        orderBy: { transcripcion: "asc" },
      }),
    ).rejects.toThrow(/encrypted field/i);
  });
});

describe("prisma-encryption — fallback legacy y datos corruptos", () => {
  it("13. fallback legacy: lee texto plano de columnas legacy si las Encrypted son null", async () => {
    const { turnoId, orgId } = await createDeps();
    const id = `legacy_${randomUUID().replace(/-/g, "")}`;

    await prismaRaw.$executeRawUnsafe(
      `INSERT INTO sesiones_clinicas
         ("id", "turnoId", "organizationId", "estado", "intentos",
          "transcripcion", "notaSubjetivo", "notaObjetivo", "notaAnalisis",
          "notaPlan", "datosEstructurados", "notasEdicion",
          "transcripcion_encrypted", "nota_soap_encrypted",
          "datos_estructurados_encrypted", "notas_edicion_encrypted",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'pendiente', 0,
               $4, $5, $6, $7,
               $8, $9, $10,
               NULL, NULL,
               NULL, NULL,
               NOW(), NOW())`,
      id,
      turnoId,
      orgId,
      "transcripción legacy en texto plano",
      "subjetivo legacy",
      "objetivo legacy",
      "analisis legacy",
      "plan legacy",
      '{"legacy":true}',
      "notas edición legacy",
    );

    const read = await db.sesionClinica.findUnique({ where: { id } });
    expect(read?.transcripcion).toBe("transcripción legacy en texto plano");
    expect(read?.notaSubjetivo).toBe("subjetivo legacy");
    expect(read?.notaObjetivo).toBe("objetivo legacy");
    expect(read?.notaAnalisis).toBe("analisis legacy");
    expect(read?.notaPlan).toBe("plan legacy");
    // datosEstructurados legacy queda como string (la columna legacy es TEXT,
    // y la rama de descifrado no se gatilla cuando el blob cifrado es NULL).
    expect(read?.datosEstructurados).toBe('{"legacy":true}');
    expect(read?.notasEdicion).toBe("notas edición legacy");
  });

  it("14. buffer cifrado corrupto (con magic prefix válido) tira error de descifrado al leer", async () => {
    const { turnoId, orgId } = await createDeps();
    const id = `corrupt_${randomUUID().replace(/-/g, "")}`;

    // Construimos un blob que pasa isEncrypted (arranca con ENC1) pero
    // tiene IV/tag/ciphertext basura. Eso fuerza a decrypt a tirar
    // "authentication tag mismatch".
    const fakeBlob = Buffer.concat([
      Buffer.from([0x45, 0x4e, 0x43, 0x31]), // ENC1
      Buffer.alloc(12, 0x00), // IV bogus
      Buffer.alloc(16, 0x00), // authTag bogus
      Buffer.from("garbage payload"),
    ]);

    await prismaRaw.$executeRawUnsafe(
      `INSERT INTO sesiones_clinicas
         ("id", "turnoId", "organizationId", "estado", "intentos",
          "transcripcion_encrypted",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'pendiente', 0, $4, NOW(), NOW())`,
      id,
      turnoId,
      orgId,
      fakeBlob,
    );

    await expect(
      db.sesionClinica.findUnique({ where: { id } }),
    ).rejects.toThrow(/authentication tag|decrypt/i);
  });
});

describe("prisma-encryption — operaciones masivas y upsert", () => {
  it("15. createMany: 3 registros, todos cifran y descifran", async () => {
    const a = await createDeps();
    const b = await createDeps();
    const c = await createDeps();

    const ids = [`m_${randomUUID()}`, `m_${randomUUID()}`, `m_${randomUUID()}`];
    await db.sesionClinica.createMany({
      data: [
        {
          id: ids[0],
          turnoId: a.turnoId,
          organizationId: a.orgId,
          transcripcion: "uno",
          notaSubjetivo: "S1",
        },
        {
          id: ids[1],
          turnoId: b.turnoId,
          organizationId: b.orgId,
          transcripcion: "dos",
          notaPlan: "P2",
        },
        {
          id: ids[2],
          turnoId: c.turnoId,
          organizationId: c.orgId,
          notasEdicion: "edición tres",
        },
      ],
    });

    const r0 = await db.sesionClinica.findUnique({ where: { id: ids[0] } });
    const r1 = await db.sesionClinica.findUnique({ where: { id: ids[1] } });
    const r2 = await db.sesionClinica.findUnique({ where: { id: ids[2] } });

    expect(r0?.transcripcion).toBe("uno");
    expect(r0?.notaSubjetivo).toBe("S1");
    expect(r1?.transcripcion).toBe("dos");
    expect(r1?.notaPlan).toBe("P2");
    expect(r2?.notasEdicion).toBe("edición tres");
  });

  it("16. upsert: crea, después actualiza transcripcion, lee el nuevo valor", async () => {
    const { turnoId, orgId } = await createDeps();

    await db.sesionClinica.upsert({
      where: { turnoId },
      create: {
        turnoId,
        organizationId: orgId,
        transcripcion: "primera versión",
      },
      update: {
        transcripcion: "primera versión",
      },
    });

    await db.sesionClinica.upsert({
      where: { turnoId },
      create: {
        turnoId,
        organizationId: orgId,
        transcripcion: "no debería usarse",
      },
      update: {
        transcripcion: "versión actualizada",
      },
    });

    const read = await db.sesionClinica.findUnique({ where: { turnoId } });
    expect(read?.transcripcion).toBe("versión actualizada");

    // Y la columna física sigue siendo un blob ENC1 fresco (con IV nuevo).
    const rows = await prismaRaw.$queryRaw<{ blob: Buffer | null }[]>`
      SELECT transcripcion_encrypted AS blob
      FROM sesiones_clinicas
      WHERE "turnoId" = ${turnoId}
    `;
    const blob = rows[0]?.blob;
    expect(blob).toBeTruthy();
    expect(blob!.subarray(0, 4).toString("hex")).toBe("454e4331");
  });
});


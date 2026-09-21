/**
 * Integración — el registro legal no se puede perder.
 *
 * Los tres actos legales del sistema —firmar la autorización de grabación,
 * revocarla y exportar documentación clínica— escriben su evento con el mismo
 * cliente que el acto (`auditar`, src/app/api/_lib/auditoria.ts). Este
 * archivo prueba lo único que importa de esa decisión: SI EL EVENTO NO SE
 * PUEDE ESCRIBIR, EL ACTO NO QUEDA HECHO.
 *
 * Antes la auditoría se escribía con el `db` global DESPUÉS del COMMIT y se
 * tragaba cualquier error: un fallo entre el COMMIT y esa línea dejaba la
 * autorización firmada (o revocada, o las notas entregadas) sin rastro. Con
 * el código anterior este archivo falla entero.
 *
 * CÓMO SE ROMPE LA AUDITORÍA. Con un trigger que hace fallar el INSERT en
 * eventos_auditoria, en la base de verdad. No es un doble: el error nace
 * donde nacería en producción (un disco lleno, un constraint, la base caída
 * a mitad de la transacción), dentro de la misma transacción del acto.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/auditoria-transaccional.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  firmarConsentimiento,
  revocarConsentimiento,
} from "@/app/api/_lib/casos-uso/consentimiento";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

// La sesión que va a leer la ruta de documentación. Se pone por test.
const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));

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

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let exportarDocumentacion!: (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const TEXTO_VERSION = "2.6";
const FIRMA = "data:image/png;base64,AAAA";

type Org = { orgId: string; userId: string; pacienteId: string };

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
      telefono: "+59899000000",
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  return { orgId: org.id, userId: user.id, pacienteId: paciente.id };
}

/** El INSERT en eventos_auditoria falla, como fallaría en producción. */
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

const consentimientosDe = (pacienteId: string) =>
  prismaRaw.consentimientoGrabacion.findMany({ where: { pacienteId } });

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());

  // Igual que multi-tenant.test.ts: el cliente de test entra por el cache
  // global que lee src/lib/db.ts, ANTES de importar la ruta.
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  const ruta = await import("@/app/api/pacientes/[id]/documentacion/route");
  exportarDocumentacion = ruta.GET as typeof exportarDocumentacion;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await repararAuditoria();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
  sesionActual.userId = "";
});

afterEach(repararAuditoria);

afterAll(async () => {
  await repararAuditoria();
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("firmar la autorización de grabación", () => {
  it("con la auditoría rota NO queda firmada", async () => {
    const org = await crearOrg();
    await romperAuditoria();

    await expect(
      firmarConsentimiento({
        prisma: db,
        organizationId: org.orgId,
        pacienteId: org.pacienteId,
        usuarioId: org.userId,
        firmaDigital: FIRMA,
        textoVersion: TEXTO_VERSION,
      }),
    ).rejects.toThrow();

    expect(await consentimientosDe(org.pacienteId)).toHaveLength(0);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });

  it("con la auditoría sana, la firma y su evento quedan juntos", async () => {
    const org = await crearOrg();

    const { consentimiento } = await firmarConsentimiento({
      prisma: db,
      organizationId: org.orgId,
      pacienteId: org.pacienteId,
      usuarioId: org.userId,
      firmaDigital: FIRMA,
      textoVersion: TEXTO_VERSION,
    });

    expect(consentimiento.vigente).toBe(true);
    expect(await consentimientosDe(org.pacienteId)).toHaveLength(1);
    const [evento] = await prismaRaw.eventoAuditoria.findMany();
    expect(evento).toMatchObject({
      accion: "consentimiento.firmar",
      entidad: "paciente",
      entidadId: org.pacienteId,
      actorId: org.userId,
      detalle: { consentimientoId: consentimiento.id, textoVersion: TEXTO_VERSION, reemplazados: 0 },
    });
  });

  it("con la auditoría rota tampoco revoca la firma anterior (la transacción entera vuelve atrás)", async () => {
    const org = await crearOrg();
    const previa = await firmarConsentimiento({
      prisma: db,
      organizationId: org.orgId,
      pacienteId: org.pacienteId,
      usuarioId: org.userId,
      firmaDigital: FIRMA,
      textoVersion: "2.5",
    });
    await romperAuditoria();

    await expect(
      firmarConsentimiento({
        prisma: db,
        organizationId: org.orgId,
        pacienteId: org.pacienteId,
        usuarioId: org.userId,
        firmaDigital: FIRMA,
        textoVersion: TEXTO_VERSION,
      }),
    ).rejects.toThrow();

    const filas = await consentimientosDe(org.pacienteId);
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe(previa.consentimiento.id);
    // Y sigue vigente: la autorización de la paciente no se tocó.
    expect(filas[0].revocadoEn).toBeNull();
  });
});

describe("revocar la autorización de grabación", () => {
  it("con la auditoría rota NO queda revocada", async () => {
    const org = await crearOrg();
    await firmarConsentimiento({
      prisma: db,
      organizationId: org.orgId,
      pacienteId: org.pacienteId,
      usuarioId: org.userId,
      firmaDigital: FIRMA,
      textoVersion: TEXTO_VERSION,
    });
    await romperAuditoria();

    await expect(
      revocarConsentimiento({
        prisma: db,
        organizationId: org.orgId,
        pacienteId: org.pacienteId,
        usuarioId: org.userId,
      }),
    ).rejects.toThrow();

    const [fila] = await consentimientosDe(org.pacienteId);
    expect(fila.revocadoEn).toBeNull();
  });

  it("con la auditoría sana, revoca y deja el evento", async () => {
    const org = await crearOrg();
    await firmarConsentimiento({
      prisma: db,
      organizationId: org.orgId,
      pacienteId: org.pacienteId,
      usuarioId: org.userId,
      firmaDigital: FIRMA,
      textoVersion: TEXTO_VERSION,
    });

    expect(
      await revocarConsentimiento({
        prisma: db,
        organizationId: org.orgId,
        pacienteId: org.pacienteId,
        usuarioId: org.userId,
      }),
    ).toEqual({ revocados: 1 });

    const [fila] = await consentimientosDe(org.pacienteId);
    expect(fila.revocadoEn).not.toBeNull();
    expect(
      (await prismaRaw.eventoAuditoria.findMany()).map((e) => e.accion),
    ).toEqual(["consentimiento.firmar", "consentimiento.revocar"]);
  });
});

describe("exportar documentación clínica", () => {
  const pedido = (org: Org) =>
    exportarDocumentacion(new Request("http://localhost/api/pacientes/x/documentacion"), {
      params: Promise.resolve({ id: org.pacienteId }),
    });

  it("con la auditoría rota NO entrega las notas", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    sesionActual.userId = org.userId;
    await romperAuditoria();

    const res = await pedido(org);

    expect(res.status).toBeGreaterThanOrEqual(500);
    // Y sobre todo: el cuerpo no trae documentación clínica.
    expect(await res.text()).not.toContain("sesiones");
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });

  it("con la auditoría sana entrega las notas y deja el evento", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    sesionActual.userId = org.userId;

    const res = await pedido(org);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ pacienteId: org.pacienteId });
    expect(
      (await prismaRaw.eventoAuditoria.findMany()).map((e) => e.accion),
    ).toEqual(["sesion.exportar"]);
  });
});

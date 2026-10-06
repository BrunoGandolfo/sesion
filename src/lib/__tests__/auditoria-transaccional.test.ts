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
import { cambiarPassword } from "@/app/api/_lib/casos-uso/cambiar-password";
import { crearTurno } from "@/app/api/_lib/casos-uso/crear-turno";
import { actualizarPaciente, crearPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { actualizarTurno } from "@/app/api/_lib/casos-uso/turnos";
import { salirDeLasDemas } from "@/app/api/_lib/casos-uso/salir-de-las-demas";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { crearSesion } from "@/lib/sesion-acceso";

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
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let exportarDocumentacion!: Handler;
let verNota!: Handler;

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
  exportarDocumentacion = ruta.GET as Handler;
  verNota = (await import("@/app/api/sesion-clinica/[id]/route")).GET as Handler;
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

describe("cerrar las demás sesiones", () => {
  async function tresSesiones(org: Org) {
    const ahora = new Date();
    return Promise.all([0, 1, 2].map(() => crearSesion(db, { userId: org.userId, ip: null, userAgent: null, ahora })));
  }
  const abiertas = (userId: string) => prismaRaw.sesionAcceso.count({ where: { userId, cerradaEn: null } });

  it("con la auditoría rota no cierra ninguna", async () => {
    const org = await crearOrg();
    const [actual] = await tresSesiones(org);
    await romperAuditoria();

    await expect(
      salirDeLasDemas({ prisma: db, organizationId: org.orgId, userId: org.userId, sesionId: actual.id }),
    ).rejects.toThrow();

    expect(await abiertas(org.userId)).toBe(3);
  });

  it("con la auditoría sana cierra las otras dos, deja la actual y el evento", async () => {
    const org = await crearOrg();
    const [actual] = await tresSesiones(org);

    expect(
      await salirDeLasDemas({ prisma: db, organizationId: org.orgId, userId: org.userId, sesionId: actual.id }),
    ).toBe(2);

    expect(await abiertas(org.userId)).toBe(1);
    const [evento] = await prismaRaw.eventoAuditoria.findMany();
    expect(evento).toMatchObject({ accion: "cuenta.salida_todas", actorId: org.userId, detalle: { cerradas: 2 } });
  });
});

describe("abrir una nota (sesion.ver)", () => {
  async function notaEnRevision(org: Org): Promise<string> {
    const turno = await prismaRaw.turno.create({
      data: { organizationId: org.orgId, pacienteId: org.pacienteId, fecha: new Date(), tarifaCobrada: 1000 },
    });
    const sesion = await prismaRaw.sesionClinica.create({
      data: { organizationId: org.orgId, turnoId: turno.id, estado: "revision" },
    });
    return sesion.id;
  }
  const pedido = (sesionId: string) =>
    verNota(new Request(`http://localhost/api/sesion-clinica/${sesionId}`), {
      params: Promise.resolve({ id: sesionId }),
    });

  it("con la auditoría rota NO entrega la nota: 500 con el mensaje de siempre", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    sesionActual.userId = org.userId;
    const sesionId = await notaEnRevision(org);
    await romperAuditoria();

    const res = await pedido(sesionId);

    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    // El mismo cuerpo que el historial clínico con la auditoría rota.
    expect(cuerpo).toEqual({ error: "Error interno" });
    expect(JSON.stringify(cuerpo)).not.toContain(sesionId);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });

  it("con la auditoría sana entrega la nota y deja sesion.ver con el estado en que la vio", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;
    sesionActual.userId = org.userId;
    const sesionId = await notaEnRevision(org);

    const res = await pedido(sesionId);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ id: sesionId, estado: "revision" });
    const eventos = await prismaRaw.eventoAuditoria.findMany();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      accion: "sesion.ver", entidadId: sesionId, actorId: org.userId, detalle: { estado: "revision" },
    });
  });

  it("una nota ajena es 404 y no deja rastro", async () => {
    const duena = await crearOrg();
    const otra = await crearOrg();
    const sesionId = await notaEnRevision(duena);
    sesionActual.organizationId = otra.orgId;
    sesionActual.userId = otra.userId;

    expect((await pedido(sesionId)).status).toBe(404);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });
});

describe("cambiar la contraseña", () => {
  const cambiar = (org: Org) =>
    cambiarPassword(
      { organizationId: org.orgId, userId: org.userId, actual: "la de siempre", nueva: "una contraseña nueva y larga" },
      { prisma: db, hashear: async () => "hash-nuevo", comparar: async () => true, huella: { ip: null, userAgent: null } },
    );
  const hashDe = async (userId: string) =>
    (await prismaRaw.user.findUniqueOrThrow({ where: { id: userId } })).hashedPassword;

  it("con la auditoría rota la contraseña no cambia y las sesiones siguen abiertas", async () => {
    const org = await crearOrg();
    await crearSesion(db, { userId: org.userId, ip: null, userAgent: null, ahora: new Date() });
    await romperAuditoria();

    await expect(cambiar(org)).rejects.toThrow();

    expect(await hashDe(org.userId)).toBe("no-importa");
    expect(await prismaRaw.sesionAcceso.count({ where: { userId: org.userId, cerradaEn: null } })).toBe(1);
  });

  it("con la auditoría sana cambia, cierra todas y deja el evento sin la contraseña", async () => {
    const org = await crearOrg();
    await crearSesion(db, { userId: org.userId, ip: null, userAgent: null, ahora: new Date() });

    expect(await cambiar(org)).toEqual({ sesionesCerradas: 1 });

    expect(await hashDe(org.userId)).toBe("hash-nuevo");
    const [evento] = await prismaRaw.eventoAuditoria.findMany();
    expect(evento).toMatchObject({ accion: "cuenta.password_cambiada", actorId: org.userId, detalle: { sesionesCerradas: 1 } });
    expect(JSON.stringify(evento.detalle)).not.toContain("hash");
  });
});

describe("pacientes y turnos dejan su rastro con el acto", () => {
  const DATOS = { nombre: "Lucía", apellido: "Ferreira", telefono: "+59899111222", tarifa: 1400, notas: "nota privada" };
  /** Ni un dato de la paciente en el rastro: sólo ids, nombres de campo y estados. */
  const sinDatosDeLaPaciente = (detalle: unknown) => {
    const texto = JSON.stringify(detalle ?? {});
    for (const dato of ["Lucía", "Ferreira", "99111222", "nota privada"]) expect(texto).not.toContain(dato);
  };

  it("crear paciente con la auditoría rota no la crea", async () => {
    const org = await crearOrg();
    await romperAuditoria();
    await expect(crearPaciente({ prisma: db, organizationId: org.orgId, usuarioId: org.userId, datos: DATOS })).rejects.toThrow();
    expect(await prismaRaw.paciente.count({ where: { organizationId: org.orgId } })).toBe(1);
  });

  it("crear y editar paciente: paciente.crear con el id, paciente.editar con los nombres de lo que cambió", async () => {
    const org = await crearOrg();
    const paciente = await crearPaciente({ prisma: db, organizationId: org.orgId, usuarioId: org.userId, datos: DATOS });
    await actualizarPaciente({
      prisma: db, organizationId: org.orgId, pacienteId: paciente.id, usuarioId: org.userId,
      // nombre igual al guardado: no cuenta como cambio.
      cambios: { nombre: "Lucía", telefono: "+59899333444", notas: "otra nota" },
    });
    // Nada cambió: no hay evento.
    await actualizarPaciente({ prisma: db, organizationId: org.orgId, pacienteId: paciente.id, usuarioId: org.userId, cambios: { nombre: "Lucía" } });

    const eventos = await prismaRaw.eventoAuditoria.findMany({ orderBy: { creadoEn: "asc" } });
    expect(eventos.map((e) => [e.accion, e.entidadId, e.actorId])).toEqual([
      ["paciente.crear", paciente.id, org.userId],
      ["paciente.editar", paciente.id, org.userId],
    ]);
    expect(eventos[1].detalle).toEqual({ campos: ["telefono", "notas"] });
    eventos.forEach((e) => sinDatosDeLaPaciente(e.detalle));
  });

  it("editar paciente con la auditoría rota no la edita", async () => {
    const org = await crearOrg();
    await romperAuditoria();
    await expect(
      actualizarPaciente({ prisma: db, organizationId: org.orgId, pacienteId: org.pacienteId, usuarioId: org.userId, cambios: { apellido: "Otra" } }),
    ).rejects.toThrow();
    expect((await prismaRaw.paciente.findUniqueOrThrow({ where: { id: org.pacienteId } })).apellido).toBe("Pérez");
  });

  const altaDeTurno = (org: Org) =>
    crearTurno({
      prisma: db, organizationId: org.orgId, usuarioId: org.userId, pacienteId: org.pacienteId,
      fecha: new Date("2030-03-04T13:00:00.000Z"), duracion: 50, modalidad: "presencial",
      notas: "nota del turno", frecuencia: "unico", ahora: new Date("2030-03-01T12:00:00.000Z"),
    });

  it("crear turno con la auditoría rota no lo crea", async () => {
    const org = await crearOrg();
    await romperAuditoria();
    await expect(altaDeTurno(org)).rejects.toThrow();
    expect(await prismaRaw.turno.count({ where: { organizationId: org.orgId } })).toBe(0);
  });

  it("crear, editar y cancelar un turno: turno.crear, turno.editar y turno.cancelar", async () => {
    const org = await crearOrg();
    const turno = await altaDeTurno(org);
    // Un minuto entre acto y acto: el orden por creadoEn es el de los actos.
    await actualizarTurno({ prisma: db, organizationId: org.orgId, usuarioId: org.userId, turnoId: turno.id, cambios: { duracion: 90, notas: "cambiada" }, ahora: new Date("2030-03-01T12:01:00.000Z") });
    await actualizarTurno({ prisma: db, organizationId: org.orgId, usuarioId: org.userId, turnoId: turno.id, cambios: { estado: "cancelado" }, ahora: new Date("2030-03-01T12:02:00.000Z") });

    const eventos = await prismaRaw.eventoAuditoria.findMany({ orderBy: { creadoEn: "asc" } });
    expect(eventos.map((e) => e.accion)).toEqual(["turno.crear", "turno.editar", "turno.cancelar"]);
    expect(eventos.every((e) => e.entidadId === turno.id && e.actorId === org.userId)).toBe(true);
    expect(eventos[0].detalle).toMatchObject({ pacienteId: org.pacienteId, creados: 1, serieId: null });
    expect(eventos[1].detalle).toEqual({ pacienteId: org.pacienteId, campos: ["duracion", "notas"], desde: "programado", hacia: "programado" });
    expect(eventos[2].detalle).toMatchObject({ desde: "programado", hacia: "cancelado" });
    // El nombre del campo sí; lo que decía la nota, nunca.
    eventos.forEach((e) => expect(JSON.stringify(e.detalle)).not.toMatch(/nota del turno|cambiada/));
  });

  it("editar un turno con la auditoría rota no lo edita", async () => {
    const org = await crearOrg();
    const turno = await altaDeTurno(org);
    await romperAuditoria();
    await expect(
      actualizarTurno({ prisma: db, organizationId: org.orgId, usuarioId: org.userId, turnoId: turno.id, cambios: { estado: "cancelado" }, ahora: new Date("2030-03-01T12:00:00.000Z") }),
    ).rejects.toThrow();
    expect((await prismaRaw.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe("programado");
  });
});

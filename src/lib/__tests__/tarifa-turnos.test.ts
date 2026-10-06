/**
 * Integración — cambiar la tarifa de una paciente alcanza a sus turnos
 * futuros sin cobrar, y a ningún otro.
 *
 * El 30-sep Mariana corrigió dos pacientes de 2.600 a 1.400 y les quedaron 6
 * turnos futuros a 2.600: `tarifaCobrada` se copia al agendar y nadie la
 * volvía a mirar. Ahora actualizarPaciente la actualiza en los turnos
 * `programado` con fecha futura y `pagoEstado: pendiente`, en la misma
 * transacción, y el PATCH contesta cuántos fueron (`turnosActualizados`,
 * el contrato con la pantalla).
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/tarifa-turnos.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { EstadoPago, EstadoTurno, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { actualizarPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

const sesionActual = vi.hoisted(() => ({ organizationId: "", userId: "" }));
vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => sesionActual.organizationId,
  getSessionActor: async () => ({ ...sesionActual, sesionId: "s", rol: "titular", nombre: "Mariana", email: "m@test.uy" }),
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let patch!: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const KEY = `1=${randomBytes(32).toString("base64")}`;
const AHORA = new Date("2026-09-30T15:00:00.000Z");
const HORA = 60 * 60 * 1000;

async function fixture() {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000000", tarifa: 2600, organizationId: org.id },
  });
  const turno = async (desdeAhoraHoras: number, estado: EstadoTurno = "programado", pagoEstado: EstadoPago = "pendiente") =>
    (await prismaRaw.turno.create({
      data: {
        organizationId: org.id, pacienteId: paciente.id, estado, pagoEstado, tarifaCobrada: 2600,
        fecha: new Date(AHORA.getTime() + desdeAhoraHoras * HORA),
      },
    })).id;
  return { organizationId: org.id, pacienteId: paciente.id, turno };
}

const tarifaDe = async (turnoId: string) =>
  (await prismaRaw.turno.findUniqueOrThrow({ where: { id: turnoId } })).tarifaCobrada;

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = KEY;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  patch = (await import("@/app/api/pacientes/[id]/route")).PATCH as typeof patch;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = KEY;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("cambiar la tarifa de la paciente", () => {
  it("la toman los programados futuros sin cobrar; los pasados, realizados, cancelados y cobrados quedan como estaban", async () => {
    const f = await fixture();
    const futuro = await f.turno(48);
    const otroFuturo = await f.turno(24 * 7);
    const pasado = await f.turno(-48);
    const realizado = await f.turno(-2, "realizado");
    const cancelado = await f.turno(72, "cancelado");
    const cobrado = await f.turno(96, "programado", "pagado");

    const paciente = await actualizarPaciente({
      prisma: db, organizationId: f.organizationId, pacienteId: f.pacienteId,
      usuarioId: "mariana", cambios: { tarifa: 1400 }, ahora: AHORA,
    });

    expect(paciente).toMatchObject({ tarifa: 1400, turnosActualizados: 2 });
    expect(await tarifaDe(futuro)).toBe(1400);
    expect(await tarifaDe(otroFuturo)).toBe(1400);
    expect(await tarifaDe(pasado)).toBe(2600);
    expect(await tarifaDe(realizado)).toBe(2600);
    expect(await tarifaDe(cancelado)).toBe(2600);
    expect(await tarifaDe(cobrado)).toBe(2600);
    const [evento] = await prismaRaw.eventoAuditoria.findMany();
    expect(evento).toMatchObject({ accion: "paciente.editar", detalle: { campos: ["tarifa"], turnosActualizados: 2 } });
  });

  it("la misma tarifa, u otro campo, no toca turnos: turnosActualizados 0", async () => {
    const f = await fixture();
    const futuro = await f.turno(48);
    const editar = (cambios: Parameters<typeof actualizarPaciente>[0]["cambios"]) =>
      actualizarPaciente({ prisma: db, organizationId: f.organizationId, pacienteId: f.pacienteId, usuarioId: "mariana", cambios, ahora: AHORA });

    expect((await editar({ tarifa: 2600 })).turnosActualizados).toBe(0);
    expect((await editar({ apellido: "Pereira" })).turnosActualizados).toBe(0);
    expect((await editar({})).turnosActualizados).toBe(0);
    expect(await tarifaDe(futuro)).toBe(2600);
  });

  it("no toca turnos de otra paciente", async () => {
    const f = await fixture();
    const otra = await fixture();
    const suyo = await otra.turno(48);

    await actualizarPaciente({
      prisma: db, organizationId: f.organizationId, pacienteId: f.pacienteId,
      usuarioId: "mariana", cambios: { tarifa: 1400 }, ahora: AHORA,
    });

    expect(await tarifaDe(suyo)).toBe(2600);
  });
});

describe("PATCH /api/pacientes/[id]", () => {
  it("contesta la paciente con turnosActualizados: number", async () => {
    const f = await fixture();
    // Futuro respecto del reloj real: la ruta usa new Date().
    await prismaRaw.turno.create({
      data: {
        organizationId: f.organizationId, pacienteId: f.pacienteId, estado: "programado",
        tarifaCobrada: 2600, fecha: new Date(Date.now() + 48 * HORA),
      },
    });
    sesionActual.organizationId = f.organizationId;
    sesionActual.userId = "mariana";

    const res = await patch(
      new Request(`http://localhost/api/pacientes/${f.pacienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarifa: 1400 }),
      }),
      { params: Promise.resolve({ id: f.pacienteId }) },
    );

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ id: f.pacienteId, tarifa: 1400, turnosActualizados: 1 });
    expect(typeof data.turnosActualizados).toBe("number");
  });
});

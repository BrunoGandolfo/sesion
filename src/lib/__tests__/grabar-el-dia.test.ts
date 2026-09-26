/**
 * Integración — POST /api/sesion-clinica solo crea la grabación de un turno
 * de HOY en Montevideo (sePuedeGrabar, domain.ts). Contra la base de test
 * (DATABASE_URL_TEST), por la ruta real.
 *
 * Antes la hoja de Agenda dejaba grabar un turno de ayer y el servidor no lo
 * impedía. Ahora contesta 400 con un mensaje que dice qué hacer, y no toca
 * nada: ni la sesión, ni el contador de grabaciones, ni la versión del turno.
 *
 * El reloj (solo Date) queda fijo a las 15:00 de Montevideo: la ruta decide
 * con new Date(), y con el reloj real el turno "de hace diez minutos" era de
 * ayer si la suite corría entre las 00:00 y las 00:10.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { MENSAJE_GRABAR_OTRO_DIA } from "@/app/api/_lib/casos-uso/audio";
import { crearTurno } from "@/app/api/_lib/casos-uso/crear-turno";
import { cifrarConsentimiento } from "@/lib/prisma-encryption";

import { vaciarTablas } from "./db-test";
import { conectarArea2, crearOrg, type Org } from "./estados-fixtures";

const estado = vi.hoisted(() => ({
  base: null as unknown as ReturnType<typeof import("./estados-fixtures").conectarArea2>,
  actor: { organizationId: "", userId: "" },
}));
vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));
vi.mock("@/app/api/_lib/auth", () => ({
  getSessionActor: async () => ({ ...estado.actor, sesionId: "s", rol: "titular", nombre: "Mariana", email: "m@test.uy" }),
}));

let POST!: typeof import("@/app/api/sesion-clinica/route").POST;
let org!: Org;

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-09-23T18:00:00.000Z"); // 15:00 en Montevideo

beforeAll(async () => {
  estado.base = conectarArea2();
  POST = (await import("@/app/api/sesion-clinica/route")).POST;
});
afterAll(async () => estado.base.prisma.$disconnect());
afterEach(() => { vi.useRealTimers(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  const { prisma } = estado.base;
  await vaciarTablas(prisma);
  org = await crearOrg(prisma);
  estado.actor = { organizationId: org.orgId, userId: org.userId };
  const id = crypto.randomUUID();
  await prisma.consentimientoGrabacion.create({
    data: {
      ...cifrarConsentimiento(id, { textoCompleto: "Prueba", firmaDigital: "Prueba" }),
      organizationId: org.orgId, pacienteId: org.pacienteId, textoVersion: "2.4",
      firmadoEn: new Date(Date.now() - 2 * DIA),
    },
  });
});

async function turnoEn(fecha: Date) {
  const fila = await estado.base.prisma.turno.create({
    data: { organizationId: org.orgId, pacienteId: org.pacienteId, fecha, tarifaCobrada: 1000 },
  });
  return fila;
}

function postear(turnoId: string) {
  return POST(new Request("http://localhost/api/sesion-clinica", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnoId }),
  }));
}

async function contador() {
  return (await estado.base.prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).grabacionesIniciadas;
}

it.each([
  ["ayer", -DIA],
  ["mañana", DIA],
])("un turno de %s responde 400 con el motivo y no crea nada", async (_nombre, desplazamiento) => {
  const turno = await turnoEn(new Date(Date.now() + desplazamiento));
  const antes = await contador();

  const respuesta = await postear(turno.id);

  expect(respuesta.status).toBe(400);
  expect(JSON.stringify(await respuesta.json())).toContain(MENSAJE_GRABAR_OTRO_DIA);
  const { prisma } = estado.base;
  expect(await prisma.sesionClinica.count({ where: { organizationId: org.orgId } })).toBe(0);
  expect(await contador()).toBe(antes);
  // El "toque" que serializa los inicios también se deshace.
  expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).actualizadoEn).toEqual(turno.actualizadoEn);
  expect(await prisma.eventoAuditoria.count({ where: { organizationId: org.orgId, accion: "sesion.crear" } })).toBe(0);
});

it("un turno de hoy crea la grabación (201)", async () => {
  const turno = await turnoEn(new Date(Date.now() - 10 * 60_000));
  const respuesta = await postear(turno.id);
  expect(respuesta.status).toBe(201);
  expect(await estado.base.prisma.sesionClinica.count({ where: { turnoId: turno.id, estado: "grabando" } })).toBe(1);
});

it("alGrabar sigue funcionando: el turno que nace al grabar se graba enseguida", async () => {
  const { id: turnoId } = await crearTurno({
    prisma: estado.base.db, organizationId: org.orgId, pacienteId: org.pacienteId,
    fecha: new Date(), duracion: 50, modalidad: "presencial", notas: null,
    frecuencia: "unico", alGrabar: true, ahora: new Date(),
  });
  const respuesta = await postear(turnoId);
  expect(respuesta.status).toBe(201);
  expect(await estado.base.prisma.sesionClinica.count({ where: { turnoId } })).toBe(1);
});

it("reanudar una grabación que ya estaba grabando no pasa por la regla del día", async () => {
  // Empezó ayer a las 23:50 y el teléfono vuelve después de medianoche: cortarla
  // dejaría el audio sin a dónde ir. No crea nada nuevo: devuelve la misma.
  const turno = await turnoEn(new Date(Date.now() - DIA));
  const sesionId = crypto.randomUUID();
  await estado.base.prisma.sesionClinica.create({
    data: { id: sesionId, organizationId: org.orgId, turnoId: turno.id, estado: "grabando" },
  });
  const antes = await contador();

  const respuesta = await postear(turno.id);

  expect(respuesta.status).toBe(201);
  expect(JSON.stringify(await respuesta.json())).toContain(sesionId);
  expect(await contador()).toBe(antes);
});

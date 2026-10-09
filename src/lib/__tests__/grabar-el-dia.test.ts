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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAJE_GRABAR_OTRO_DIA } from "@/app/api/_lib/casos-uso/audio";
import { GRABACION_OTRO_DIA_QUE_EL_TURNO, GRABACION_VENCIDA } from "@/lib/glosario";
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
let POST_TURNOS!: typeof import("@/app/api/turnos/route").POST;
let org!: Org;

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-09-23T18:00:00.000Z"); // 15:00 en Montevideo

beforeAll(async () => {
  estado.base = conectarArea2();
  POST = (await import("@/app/api/sesion-clinica/route")).POST;
  POST_TURNOS = (await import("@/app/api/turnos/route")).POST;
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

function postear(turnoId: string, iniciadaEn?: Date) {
  return POST(new Request("http://localhost/api/sesion-clinica", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnoId, ...(iniciadaEn ? { iniciadaEn: iniciadaEn.toISOString() } : {}) }),
  }));
}

/** El turno de una grabación sin turno, como lo pide la pantalla al subir. */
function crearTurnoAlGrabar(inicio: Date, iniciadaEn: Date | null = inicio) {
  return POST_TURNOS(new Request("http://localhost/api/turnos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pacienteId: org.pacienteId, fecha: inicio.toISOString(), duracion: 50, modalidad: "presencial",
      alGrabar: true, ...(iniciadaEn ? { iniciadaEn: iniciadaEn.toISOString() } : {}),
    }),
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
    prisma: estado.base.db, organizationId: org.orgId, pacienteId: org.pacienteId, usuarioId: "usuaria-de-prueba",
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

// ─── Con el inicio de la grabación (iniciadaEn) ─────────────────────────────
// Grabar no espera a la red: la sesión nace al subir. El cliente manda cuándo
// empezó a grabar y el servidor acepta si es del día del turno y de las
// últimas 36 horas (plazo-grabacion.ts, motivoGrabacionNoAdmitida).

describe("con iniciadaEn", () => {
  it("una sesión de las 23:30 que sube a las 00:10 se acepta; sin iniciadaEn, la regla de hoy la rechaza", async () => {
    const lasOnceYMedia = new Date("2026-09-24T02:30:00.000Z"); // 23:30 del 23 en Montevideo
    vi.setSystemTime(new Date("2026-09-24T03:10:00.000Z")); // 00:10 del 24
    const turno = await turnoEn(lasOnceYMedia);

    const sinInicio = await postear(turno.id);
    expect(sinInicio.status).toBe(400);
    expect(JSON.stringify(await sinInicio.json())).toContain(MENSAJE_GRABAR_OTRO_DIA);

    const conInicio = await postear(turno.id, lasOnceYMedia);
    expect(conInicio.status).toBe(201);
    expect(await estado.base.prisma.sesionClinica.count({ where: { turnoId: turno.id, estado: "grabando" } })).toBe(1);
  });

  it("el reintento al día siguiente de una grabación sin turno crea el turno con la fecha original y la sesión", async () => {
    const inicio = new Date("2026-09-24T00:10:00.000Z"); // 21:10 del 23 en Montevideo
    vi.setSystemTime(new Date("2026-09-24T18:00:00.000Z")); // 15:00 del 24

    const creado = await crearTurnoAlGrabar(inicio);
    expect(creado.status).toBe(201);
    const { data: turno } = (await creado.json()) as { data: { id: string; fecha: string } };
    expect(turno.fecha).toBe(inicio.toISOString());

    const sesion = await postear(turno.id, inicio);
    expect(sesion.status).toBe(201);
    expect(await estado.base.prisma.sesionClinica.count({ where: { turnoId: turno.id } })).toBe(1);
  });

  it("una grabación que empezó hace tres días se rechaza con un motivo claro, y no crea nada", async () => {
    const haceTresDias = new Date(Date.now() - 3 * DIA);
    const turno = await turnoEn(haceTresDias);
    const antes = await contador();

    const sesion = await postear(turno.id, haceTresDias);
    expect(sesion.status).toBe(400);
    expect(((await sesion.json()) as { error: string }).error).toBe(GRABACION_VENCIDA);
    expect(GRABACION_VENCIDA).toBe("Esta grabación empezó hace más de 36 horas y ya no se puede enviar. Sigue guardada en el teléfono.");
    expect(await estado.base.prisma.sesionClinica.count({ where: { organizationId: org.orgId } })).toBe(0);
    expect(await contador()).toBe(antes);

    const turnosAntes = await estado.base.prisma.turno.count({ where: { organizationId: org.orgId } });
    const nuevo = await crearTurnoAlGrabar(haceTresDias);
    expect(nuevo.status).toBe(400);
    expect(((await nuevo.json()) as { error: string }).error).toBe(GRABACION_VENCIDA);
    expect(await estado.base.prisma.turno.count({ where: { organizationId: org.orgId } })).toBe(turnosAntes);
  });

  it("una grabación de otro día que el turno, o con la hora de inicio en el futuro, se rechaza", async () => {
    const turno = await turnoEn(new Date(Date.now() - 10 * 60_000));
    const ayer = await postear(turno.id, new Date(Date.now() - DIA));
    expect(ayer.status).toBe(400);
    expect(((await ayer.json()) as { error: string }).error).toBe(GRABACION_OTRO_DIA_QUE_EL_TURNO);
    const futura = await postear(turno.id, new Date(Date.now() + 60 * 60_000));
    expect(futura.status).toBe(400);
    // El turno de una grabación tiene que ser del día en que empezó.
    const corrido = await crearTurnoAlGrabar(new Date(Date.now() + DIA), new Date());
    expect(corrido.status).toBe(400);
    expect(await estado.base.prisma.sesionClinica.count({ where: { organizationId: org.orgId } })).toBe(0);
  });

  it("el turno de una grabación es idempotente: un reintento con el mismo inicio devuelve el mismo", async () => {
    const inicio = new Date(Date.now() - 20 * 60_000 + 123); // con milisegundos, como el teléfono
    const primero = await crearTurnoAlGrabar(inicio);
    const segundo = await crearTurnoAlGrabar(inicio);
    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(201);
    const a = ((await primero.json()) as { data: { id: string } }).data.id;
    const b = ((await segundo.json()) as { data: { id: string } }).data.id;
    expect(b).toBe(a);
    expect(await estado.base.prisma.turno.count({ where: { organizationId: org.orgId, fecha: inicio } })).toBe(1);
    // Sin iniciadaEn no hay identidad que comparar: alGrabar crea como siempre.
    const sinInicio = await crearTurnoAlGrabar(inicio, null);
    expect(((await sinInicio.json()) as { data: { id: string } }).data.id).not.toBe(a);
  });

  it("iniciadaEn sólo va con alGrabar al crear un turno", async () => {
    const respuesta = await POST_TURNOS(new Request("http://localhost/api/turnos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pacienteId: org.pacienteId, fecha: new Date().toISOString(), duracion: 50, modalidad: "presencial",
        iniciadaEn: new Date().toISOString(),
      }),
    }));
    expect(respuesta.status).toBe(400);
  });
});

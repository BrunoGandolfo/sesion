/**
 * Integración — invitaciones y alta: permiso, límites de invitaciones, alta atómica
 * (org + usuaria + configuración + sesión + eventos) y la ruta que deja la
 * cookie. Contra la base de test (DATABASE_URL_TEST).
 */
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  consultarInvitaciones,
  crearInvitacion,
  registrarCuenta,
} from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { INVITAR_AGOTADAS } from "@/lib/glosario";
import { ESPERA_ENTRE_INVITACIONES_MS, TOPE_INVITACIONES_TOTAL } from "@/lib/limites-prueba";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { BCRYPT_RONDAS } from "@/lib/password";
import { buscarSesionViva, hashTokenSesion, nuevoTokenSesion } from "@/lib/sesion-acceso";
import { nombreCookie } from "@/lib/sesion-cookie";
import { tokenDeCookieHeader } from "./ayudantes";

import { CLAVES_CIFRADO_TEST, conectarBaseIdentidad, vaciarBaseIdentidad, type BaseIdentidad } from "./base-identidad";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseIdentidad, cookie: null as string | null }));
vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (estado.cookie ? { value: estado.cookie } : undefined) }),
}));
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T,>(fn: T) => fn };
});

// El reloj real, no una fecha escrita a mano. La invitación se crea con
// `ahora` y la ruta de registro la consume con la hora del servidor; la sesión
// se busca con `new Date()`. Con una fecha fija, la invitación vencía a los
// siete días y la sesión moría a los catorce de inactividad: la prueba pasaba
// sólo cerca de esa fecha. Así mide los mismos plazos corra el día que corra.
const ahora = new Date();
const huella = { ip: "203.0.113.7", userAgent: "vitest" };
const datos = { nombre: "Colega", email: "colega@example.test", password: "contraseña larga", aceptaTerminos: true };
const hashear = (p: string) => bcrypt.hash(p, BCRYPT_RONDAS);
const ORIGINAL = process.env.INVITACIONES_PERMITIDAS;

beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  estado.base = conectarBaseIdentidad();
});
beforeEach(async () => {
  estado.cookie = null;
  await vaciarBaseIdentidad(estado.base.prisma);
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.INVITACIONES_PERMITIDAS; else process.env.INVITACIONES_PERMITIDAS = ORIGINAL;
});
afterAll(() => estado.base.prisma.$disconnect());

async function preparar() {
  const { prisma } = estado.base;
  const org = await prisma.organization.create({ data: { nombre: "Consultorio invitante" } });
  const invitante = await prisma.user.create({ data: { organizationId: org.id, nombre: "Invitante", email: `inv-${randomUUID()}@example.test`, hashedPassword: "hash" } });
  process.env.INVITACIONES_PERMITIDAS = invitante.email;
  const repo = repositorioRegistro(estado.base.db);
  const actor = { userId: invitante.id, email: invitante.email, rol: "titular" };
  const enlace = await crearInvitacion(actor, repo, ahora);
  const token = new URL(enlace.enlace).searchParams.get("token")!;
  return { org, invitante, repo, token, actor };
}

function depsRegistro(repo: ReturnType<typeof repositorioRegistro>) {
  return { repo, hashear, ahora, huella, tokenSesion: nuevoTokenSesion(), hashTokenSesion };
}

it("crea un consultorio propio con configuración vacía, sesión abierta y los dos eventos, sin token ni email en el rastro", async () => {
  const { org, repo, token, invitante } = await preparar();
  const deps = depsRegistro(repo);
  const nuevo = await registrarCuenta({ ...datos, token }, deps);
  expect(nuevo.organizationId).not.toBe(org.id);
  const { prisma } = estado.base;

  const config = await prisma.configuracion.findUniqueOrThrow({ where: { organizationId: nuevo.organizationId } });
  expect(config).toMatchObject({ tarifaDefault: 0, nombreProfesional: "", direccion: "" });
  const usuario = await prisma.user.findUniqueOrThrow({ where: { id: nuevo.userId } });
  expect(usuario.rol).toBe("titular");
  // El consultorio nuevo es de prueba; el de quien invita, no.
  expect((await prisma.organization.findUniqueOrThrow({ where: { id: nuevo.organizationId } })).deInvitacion).toBe(true);
  expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).deInvitacion).toBe(false);
  expect(await bcrypt.compare(datos.password, usuario.hashedPassword)).toBe(true);

  const sesion = await buscarSesionViva(estado.base.db, deps.tokenSesion, new Date());
  expect(sesion?.id).toBe(nuevo.sesionId);
  expect(sesion?.user.id).toBe(nuevo.userId);

  const registro = await prisma.eventoAuditoria.findFirstOrThrow({ where: { organizationId: nuevo.organizationId, accion: "cuenta.registro" } });
  expect(registro.detalle).toMatchObject({ aceptaTerminos: true });
  const usada = await prisma.eventoAuditoria.findFirstOrThrow({ where: { organizationId: org.id, accion: "cuenta.invitacion_usada" } });
  expect(usada.actorId).toBe(invitante.id);
  expect(usada.detalle).toMatchObject({ usuarioNuevoId: nuevo.userId });
  for (const e of [registro, usada]) {
    expect(JSON.stringify(e.detalle)).not.toContain(datos.email);
    expect(JSON.stringify(e.detalle)).not.toContain(token);
  }

  await expect(registrarCuenta({ ...datos, email: "otra@example.test", token }, depsRegistro(repo))).rejects.toMatchObject({ status: 400 });
});

it("una invitación simultánea sólo crea una organización", async () => {
  const { repo, token } = await preparar();
  const resultados = await Promise.allSettled(["una@example.test", "otra@example.test"].map((email) => registrarCuenta({ ...datos, email, token }, depsRegistro(repo))));
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await estado.base.prisma.organization.count()).toBe(2);
  expect(await estado.base.prisma.configuracion.count()).toBe(1);
});

it("email repetido no consume la invitación ni crea un consultorio", async () => {
  const { repo, token, invitante } = await preparar();
  await expect(registrarCuenta({ ...datos, email: invitante.email, token }, depsRegistro(repo))).rejects.toMatchObject({ status: 400 });
  expect(await estado.base.prisma.organization.count()).toBe(1);
  expect((await estado.base.prisma.invitacion.findUniqueOrThrow({ where: { tokenHash: await hashTokenCuenta(token) } })).usadaEn).toBeNull();
});

it("un fallo después de crear la organización revierte también el consumo", async () => {
  const { repo, token } = await preparar();
  const invitacion = await estado.base.prisma.invitacion.findUniqueOrThrow({ where: { tokenHash: await hashTokenCuenta(token) } });
  await expect(repo.registrar({
    invitacionId: invitacion.id, nombre: datos.nombre, email: datos.email, hashedPassword: undefined as unknown as string, ahora,
    sesion: { tokenHash: "x".repeat(64), ip: null, userAgent: null },
  })).rejects.toThrow();
  expect(await estado.base.prisma.organization.count()).toBe(1);
  expect(await estado.base.prisma.sesionAcceso.count()).toBe(0);
  expect((await estado.base.prisma.invitacion.findUniqueOrThrow({ where: { id: invitacion.id } })).usadaEn).toBeNull();
});

const DIA = 24 * 60 * 60 * 1000;

it("la sexta invitación no se puede generar, ni aunque la limpieza haya purgado las anteriores", async () => {
  const { repo, actor } = await preparar(); // la primera, ahora
  for (let i = 1; i < TOPE_INVITACIONES_TOTAL; i++) {
    await crearInvitacion(actor, repo, new Date(ahora.getTime() + i * ESPERA_ENTRE_INVITACIONES_MS));
  }
  expect(await estado.base.prisma.invitacion.count()).toBe(5);
  // El mantenimiento borra las invitaciones viejas: el contador no depende de esas filas.
  await estado.base.prisma.invitacion.deleteMany();
  const muchoDespues = new Date(ahora.getTime() + 400 * DIA);
  await expect(crearInvitacion(actor, repo, muchoDespues)).rejects.toMatchObject({ status: 429, message: INVITAR_AGOTADAS });
  expect(await estado.base.prisma.invitacion.count()).toBe(0);
  expect(await consultarInvitaciones(actor, repo, muchoDespues)).toEqual({ restantes: 0, aviso: INVITAR_AGOTADAS });
});

it("una segunda antes de los treinta días no se genera, y el aviso dice desde cuándo sí", async () => {
  const { repo, actor, invitante } = await preparar();
  const casi = new Date(ahora.getTime() + ESPERA_ENTRE_INVITACIONES_MS - 1);
  await expect(crearInvitacion(actor, repo, casi)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("Vas a poder generar la próxima desde el ") });
  const { aviso, restantes } = await consultarInvitaciones(actor, repo, casi);
  expect(restantes).toBe(4);
  expect(aviso).toContain("Vas a poder generar la próxima desde el ");
  expect(await estado.base.prisma.invitacion.count()).toBe(1);
  expect(await estado.base.prisma.user.findUniqueOrThrow({ where: { id: invitante.id } })).toMatchObject({ invitacionesGeneradas: 1, ultimaInvitacionEn: ahora });

  await expect(crearInvitacion(actor, repo, new Date(ahora.getTime() + ESPERA_ENTRE_INVITACIONES_MS))).resolves.toBeDefined();
  process.env.INVITACIONES_PERMITIDAS = "otra@example.test";
  await expect(crearInvitacion(actor, repo, new Date(ahora.getTime() + 90 * DIA))).rejects.toMatchObject({ status: 403 });
});

it("en paralelo: cinco pedidos a la vez generan una sola invitación", async () => {
  const { repo, actor, invitante } = await preparar();
  await estado.base.prisma.invitacion.deleteMany();
  await estado.base.prisma.user.update({ where: { id: invitante.id }, data: { invitacionesGeneradas: 0, ultimaInvitacionEn: null } });
  const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => crearInvitacion(actor, repo, ahora)));
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  for (const r of resultados.filter((r) => r.status === "rejected")) {
    expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 429 });
  }
  expect(await estado.base.prisma.invitacion.count()).toBe(1);
  expect((await estado.base.prisma.user.findUniqueOrThrow({ where: { id: invitante.id } })).invitacionesGeneradas).toBe(1);
});

it("POST /api/cuenta/registro responde 201 con la cookie de la sesión creada, y esa cookie autentica", async () => {
  const { token } = await preparar();
  const { POST } = await import("@/app/api/cuenta/registro/route");
  const res = await POST(new Request("http://localhost/api/cuenta/registro", {
    method: "POST", headers: { "x-forwarded-for": huella.ip }, body: JSON.stringify({ ...datos, token }),
  }));
  expect(res.status).toBe(201);
  const cookie = tokenDeCookieHeader(res.headers.get("set-cookie")!.split(";")[0], nombreCookie());
  expect(cookie).not.toBeNull();

  estado.cookie = cookie;
  const { getSessionActor } = await import("@/app/api/_lib/auth");
  const actor = await getSessionActor();
  expect(actor.email).toBe(datos.email);
  expect(actor.rol).toBe("titular");
});

it("GET y POST /api/cuenta/invitaciones exigen sesión; el POST deja el evento y el GET muestra el cupo", async () => {
  const { invitante, org } = await preparar();
  // La que generó preparar() fue hace 31 días: hoy se puede generar otra.
  await estado.base.prisma.user.update({ where: { id: invitante.id }, data: { ultimaInvitacionEn: new Date(Date.now() - 31 * DIA) } });
  const sesion = await estado.base.db.sesionAcceso.create({
    data: { userId: invitante.id, tokenHash: "s".repeat(64), ultimoUsoEn: new Date(), venceEn: new Date(Date.now() + 86_400_000) },
  });
  void sesion;
  estado.cookie = null;
  const { GET, POST } = await import("@/app/api/cuenta/invitaciones/route");
  expect((await POST()).status).toBe(401);
  expect((await GET()).status).toBe(401);

  // El token en claro no importa acá: buscarSesionViva hashea la cookie, así
  // que se crea la sesión desde un token real.
  const { crearSesion } = await import("@/lib/sesion-acceso");
  const creada = await crearSesion(estado.base.db, { userId: invitante.id, ip: null, userAgent: null, ahora: new Date() });
  estado.cookie = creada.token;
  const res = await POST();
  expect(res.status).toBe(200);
  const cuerpo = await res.json();
  expect(cuerpo.data.enlace).toMatch(/\/registro\?token=[a-f0-9]{64}$/);
  const evento = await estado.base.prisma.eventoAuditoria.findFirstOrThrow({ where: { organizationId: org.id, accion: "cuenta.invitacion_creada" } });
  expect(JSON.stringify(evento.detalle)).not.toContain(cuerpo.data.enlace.split("token=")[1]);

  const cupo = await (await GET()).json();
  expect(cupo.data.restantes).toBe(3);
  expect(cupo.data.aviso).toContain("Vas a poder generar la próxima desde el ");
  expect((await POST()).status).toBe(429);
});

/**
 * Integración — invitaciones y alta: permiso, tope de vigentes, alta atómica
 * (org + usuaria + configuración + sesión + eventos) y la ruta que deja la
 * cookie. Contra la base de test (DATABASE_URL_TEST).
 */
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  crearInvitacion,
  MAX_INVITACIONES_VIGENTES,
  registrarCuenta,
} from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { BCRYPT_RONDAS } from "@/lib/password";
import { buscarSesionViva, hashTokenSesion, nuevoTokenSesion } from "@/lib/sesion-acceso";
import { nombreCookie, tokenDeCookieHeader } from "@/lib/sesion-cookie";

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

it(`tope: la invitación ${MAX_INVITACIONES_VIGENTES + 1} vigente es 429; usar una libera el cupo; sin permiso es 403`, async () => {
  const { repo, actor } = await preparar(); // ya hay 1 vigente
  await crearInvitacion(actor, repo, ahora);
  await expect(crearInvitacion(actor, repo, ahora)).rejects.toMatchObject({ status: 429 });
  expect(await estado.base.prisma.invitacion.count()).toBe(MAX_INVITACIONES_VIGENTES);

  const primera = await estado.base.prisma.invitacion.findFirstOrThrow();
  await estado.base.prisma.invitacion.update({ where: { id: primera.id }, data: { usadaEn: ahora } });
  await expect(crearInvitacion(actor, repo, ahora)).resolves.toBeDefined();

  process.env.INVITACIONES_PERMITIDAS = "otra@example.test";
  await expect(crearInvitacion(actor, repo, ahora)).rejects.toMatchObject({ status: 403 });
});

it(`tope en paralelo: ${MAX_INVITACIONES_VIGENTES + 3} pedidos a la vez dejan exactamente ${MAX_INVITACIONES_VIGENTES} vigentes`, async () => {
  const { repo, actor } = await preparar(); // ya hay 1 vigente
  const resultados = await Promise.allSettled(
    Array.from({ length: MAX_INVITACIONES_VIGENTES + 3 }, () => crearInvitacion(actor, repo, ahora)),
  );
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_INVITACIONES_VIGENTES - 1);
  for (const r of resultados.filter((r) => r.status === "rejected")) {
    expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 429 });
  }
  expect(await estado.base.prisma.invitacion.count({ where: { usadaEn: null } })).toBe(MAX_INVITACIONES_VIGENTES);
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

it("POST /api/cuenta/invitaciones exige sesión y permiso, y deja el evento", async () => {
  const { invitante, org } = await preparar();
  const sesion = await estado.base.db.sesionAcceso.create({
    data: { userId: invitante.id, tokenHash: "s".repeat(64), ultimoUsoEn: new Date(), venceEn: new Date(Date.now() + 86_400_000) },
  });
  void sesion;
  estado.cookie = null;
  const { POST } = await import("@/app/api/cuenta/invitaciones/route");
  expect((await POST()).status).toBe(401);

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
});

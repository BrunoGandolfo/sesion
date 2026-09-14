/**
 * Integración — cambio de contraseña atómico (intentos_acceso, clave
 * usuario:<id>) y las rutas de sesión: password cierra TODAS las sesiones y
 * borra la cookie; salir cierra la propia; salir-todas las demás; sesiones
 * lista sin IP. Contra la base de test (DATABASE_URL_TEST).
 */
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { claveUsuario, evaluarBloqueoDe, procesarCambioPassword } from "@/lib/intentos-acceso";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { UMBRAL_INTENTOS } from "@/lib/login-intentos";
import { BCRYPT_RONDAS } from "@/lib/password";
import { buscarSesionViva, crearSesion } from "@/lib/sesion-acceso";

import {
  CLAVES_CIFRADO_TEST,
  conectarBaseIdentidad,
  vaciarBaseIdentidad,
  type BaseIdentidad,
} from "./base-identidad";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseIdentidad, cookie: null as string | null }));
vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (estado.cookie ? { value: estado.cookie } : undefined) }),
}));
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T,>(fn: T) => fn };
});

const AHORA = new Date("2026-09-05T15:00:00.000Z");
const HUELLA = { ip: "203.0.113.7", userAgent: "vitest" };
const EN_PARALELO = 12;
const PASSWORD = "contraseña larga y buena";

beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  estado.base = conectarBaseIdentidad();
});
beforeEach(async () => {
  estado.cookie = null;
  await vaciarBaseIdentidad(estado.base.prisma);
});
afterAll(() => estado.base.prisma.$disconnect());

async function cuenta() {
  const org = await estado.base.prisma.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await estado.base.prisma.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: await bcrypt.hash(PASSWORD, BCRYPT_RONDAS), nombre: "Mariana", organizationId: org.id },
  });
  return { organizationId: org.id, userId: user.id };
}

function intentar(c: { organizationId: string; userId: string }, verificar: (h: string) => Promise<boolean>) {
  return procesarCambioPassword({ prisma: estado.base.db, ...c, ahora: AHORA, huella: HUELLA, verificar });
}

describe("procesarCambioPassword", () => {
  it("N intentos con la contraseña equivocada en paralelo: se compara exactamente UMBRAL veces", async () => {
    const c = await cuenta();
    let comparaciones = 0;
    const resultados = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => intentar(c, async () => { comparaciones += 1; return false; })),
    );
    expect(comparaciones).toBe(UMBRAL_INTENTOS);
    expect(resultados.filter((r) => r.estado === "credencial-incorrecta")).toHaveLength(UMBRAL_INTENTOS);
    expect(resultados.filter((r) => r.estado === "bloqueado")).toHaveLength(EN_PARALELO - UMBRAL_INTENTOS);
    expect(await estado.base.prisma.intentoAcceso.count({ where: { tipo: "password", clave: claveUsuario(c.userId) } })).toBe(UMBRAL_INTENTOS);
    expect((await evaluarBloqueoDe(estado.base.db, "password", [claveUsuario(c.userId)], AHORA)).bloqueado).toBe(true);
  });

  it("con la contraseña bien: ok y ninguna fila", async () => {
    const c = await cuenta();
    expect(await intentar(c, async () => true)).toMatchObject({ estado: "ok", hashVerificado: expect.stringMatching(/^\$2/) });
    expect(await estado.base.prisma.intentoAcceso.count()).toBe(0);
  });

  it("usuaria de otra organización: sin-usuario, sin comparar", async () => {
    const c = await cuenta();
    let comparado = false;
    expect(await intentar({ ...c, organizationId: "otra" }, async () => { comparado = true; return true; })).toEqual({ estado: "sin-usuario" });
    expect(comparado).toBe(false);
  });
});

describe("rutas de sesión", () => {
  async function conSesiones(cuantas: number) {
    const c = await cuenta();
    const sesiones = [];
    for (let i = 0; i < cuantas; i++) {
      sesiones.push(await crearSesion(estado.base.db, { userId: c.userId, ip: HUELLA.ip, userAgent: `dispositivo ${i}`, ahora: new Date() }));
    }
    estado.cookie = sesiones[0].token;
    return { ...c, sesiones };
  }

  it("POST /password cierra TODAS las sesiones (la actual incluida), invalida enlaces y borra la cookie", async () => {
    const { userId, sesiones } = await conSesiones(3);
    await estado.base.prisma.passwordReset.create({
      data: { userId, tokenHash: "a".repeat(64), venceEn: new Date(Date.now() + 3_600_000), enviadoEn: new Date() },
    });
    const { POST } = await import("@/app/api/cuenta/password/route");
    const res = await POST(new Request("http://localhost/api/cuenta/password", {
      method: "POST", body: JSON.stringify({ actual: PASSWORD, nueva: "contraseña nueva y distinta" }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { cambiada: true, reingresar: true } });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);

    for (const s of sesiones) expect(await buscarSesionViva(estado.base.db, s.token, new Date())).toBeNull();
    const cerradas = await estado.base.prisma.sesionAcceso.findMany({ where: { userId } });
    expect(cerradas.every((s) => s.motivoCierre === "cambio_password")).toBe(true);
    expect(await estado.base.prisma.passwordReset.count({ where: { userId, usadoEn: null } })).toBe(0);
    const guardado = await estado.base.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("contraseña nueva y distinta", guardado.hashedPassword)).toBe(true);
    const evento = await estado.base.prisma.eventoAuditoria.findFirstOrThrow({ where: { accion: "cuenta.password_cambiada" } });
    expect(evento.detalle).toEqual({ sesionesCerradas: 3 });
    expect(JSON.stringify(evento.detalle)).not.toContain(HUELLA.ip);
  });

  it("si la contraseña cambió entre la verificación y la escritura (restablecimiento concurrente), no la pisa: 401", async () => {
    const { userId } = await conSesiones(1);
    const hashRestablecida = await bcrypt.hash("restablecida por correo", BCRYPT_RONDAS);
    const hashReal = bcrypt.hash;
    // La ruta verifica la actual, hashea la nueva y recién después escribe.
    // Entre medio, "alguien" restablece por correo.
    const espia = vi.spyOn(bcrypt, "hash").mockImplementationOnce((async (p: string, r: number) => {
      await estado.base.prisma.user.update({ where: { id: userId }, data: { hashedPassword: hashRestablecida } });
      return hashReal(p, r);
    }) as typeof bcrypt.hash);
    try {
      const { POST } = await import("@/app/api/cuenta/password/route");
      const res = await POST(new Request("http://localhost/api/cuenta/password", {
        method: "POST", body: JSON.stringify({ actual: PASSWORD, nueva: "contraseña del atacante" }),
      }));
      expect(res.status).toBe(401);
    } finally {
      espia.mockRestore();
    }
    const guardado = await estado.base.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(guardado.hashedPassword).toBe(hashRestablecida);
    expect(await estado.base.prisma.eventoAuditoria.count({ where: { accion: "cuenta.password_cambiada" } })).toBe(0);
  });

  it("POST /limpiar borra la cookie solo si no resuelve a una sesión viva", async () => {
    const { userId, sesiones } = await conSesiones(1);
    const { POST } = await import("@/app/api/cuenta/limpiar/route");
    const viva = await POST();
    expect(await viva.json()).toEqual({ data: { viva: true } });
    expect(viva.headers.get("set-cookie")).toBeNull();
    expect(await buscarSesionViva(estado.base.db, sesiones[0].token, new Date())).not.toBeNull();

    await estado.base.prisma.sesionAcceso.updateMany({ where: { userId }, data: { cerradaEn: new Date(), motivoCierre: "salida" } });
    const muerta = await POST();
    expect(await muerta.json()).toEqual({ data: { viva: false } });
    expect(muerta.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("POST /password con la actual equivocada: 400 y nada cambia; sin sesión: 401", async () => {
    const { sesiones } = await conSesiones(1);
    const { POST } = await import("@/app/api/cuenta/password/route");
    const res = await POST(new Request("http://localhost/api/cuenta/password", {
      method: "POST", body: JSON.stringify({ actual: "no es", nueva: "contraseña nueva y distinta" }),
    }));
    expect(res.status).toBe(400);
    expect(await buscarSesionViva(estado.base.db, sesiones[0].token, new Date())).not.toBeNull();
    estado.cookie = null;
    const sin = await POST(new Request("http://localhost/api/cuenta/password", {
      method: "POST", body: JSON.stringify({ actual: PASSWORD, nueva: "contraseña nueva y distinta" }),
    }));
    expect(sin.status).toBe(401);
  });

  it("GET /sesiones lista las vivas sin IP y marca la actual; POST /salir-todas cierra las demás; POST /salir la propia", async () => {
    const { sesiones } = await conSesiones(3);
    const { GET } = await import("@/app/api/cuenta/sesiones/route");
    const lista = await (await GET()).json();
    expect(lista.data.sesiones).toHaveLength(3);
    expect(lista.data.sesiones.filter((s: { actual: boolean }) => s.actual)).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain(HUELLA.ip);
    expect(lista.data.usuaria).toMatchObject({ nombre: "Mariana" });

    const { POST: salirTodas } = await import("@/app/api/cuenta/salir-todas/route");
    expect(await (await salirTodas()).json()).toEqual({ data: { cerradas: 2 } });
    expect(await buscarSesionViva(estado.base.db, sesiones[0].token, new Date())).not.toBeNull();
    expect(await buscarSesionViva(estado.base.db, sesiones[1].token, new Date())).toBeNull();

    const { POST: salir } = await import("@/app/api/cuenta/salir/route");
    const res = await salir();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await buscarSesionViva(estado.base.db, sesiones[0].token, new Date())).toBeNull();

    // Con la cookie ya muerta, salir sigue contestando 200 y borrando la cookie.
    const otra = await salir();
    expect(otra.status).toBe(200);
    expect(otra.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

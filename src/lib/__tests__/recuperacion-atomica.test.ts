/**
 * Integración — recuperar y restablecer: cupo de 3 por hora resistente a
 * pedidos paralelos, correo fallido que no gasta cupo ni mata enlaces,
 * bloqueo por IP, y consumo que cierra todas las sesiones. Contra la base de
 * test (DATABASE_URL_TEST).
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { restablecerCuenta, solicitarRecuperacion } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { repositorioRecuperacion } from "@/lib/cuenta-recuperacion-db";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { UMBRAL_INTENTOS } from "@/lib/login-intentos";
import { BCRYPT_RONDAS } from "@/lib/password";
import { buscarSesionViva, crearSesion } from "@/lib/sesion-acceso";

import { CLAVES_CIFRADO_TEST, conectarBaseIdentidad, vaciarBaseIdentidad, type BaseIdentidad } from "./base-identidad";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseIdentidad }));
vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));

const ahora = new Date("2026-09-10T12:00:00Z");
const huella = { ip: "203.0.113.7", userAgent: "vitest" };
const token = "a".repeat(64);
const deps = { comparar: bcrypt.compare, hashear: (p: string) => bcrypt.hash(p, BCRYPT_RONDAS) };

beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  estado.base = conectarBaseIdentidad();
});
beforeEach(() => vaciarBaseIdentidad(estado.base.prisma));
afterAll(() => estado.base.prisma.$disconnect());

async function usuaria() {
  const org = await estado.base.prisma.organization.create({ data: { nombre: "Consultorio de test" } });
  return estado.base.prisma.user.create({
    data: { organizationId: org.id, email: "colega@example.test", nombre: "Colega", hashedPassword: await bcrypt.hash("contraseña anterior", BCRYPT_RONDAS) },
  });
}

it("el cupo de 3 por hora resiste pedidos paralelos: 3 reservas, 3 correos, los demás no gastan nada", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  const enviar = vi.fn().mockResolvedValue(undefined);
  await Promise.all(Array.from({ length: 5 }, (_, i) =>
    solicitarRecuperacion(user.email, { repo, enviar, huella: { ip: `203.0.113.${i}`, userAgent: null }, ahora, crearToken: () => `${i}`.repeat(64) }),
  ));
  expect(enviar).toHaveBeenCalledTimes(3);
  const filas = await estado.base.prisma.passwordReset.findMany({ where: { userId: user.id } });
  expect(filas).toHaveLength(3);
  expect(filas.every((f) => f.enviadoEn !== null)).toBe(true);
  // Vivo queda uno solo: cada confirmación invalida los anteriores.
  expect(filas.filter((f) => f.usadoEn === null)).toHaveLength(1);
  // Una hora después el cupo vuelve.
  const mas = vi.fn().mockResolvedValue(undefined);
  await solicitarRecuperacion(user.email, { repo, enviar: mas, huella, ahora: new Date(ahora.getTime() + 3_600_001), crearToken: () => "f".repeat(64) });
  expect(mas).toHaveBeenCalledTimes(1);
});

it("si el correo falla: la fila se borra, el enlace anterior sigue vivo y el cupo no se gastó", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  await solicitarRecuperacion(user.email, { repo, enviar: vi.fn().mockResolvedValue(undefined), huella, ahora, crearToken: () => token });
  const roto = vi.fn().mockRejectedValue(new Error("Resend caído"));
  for (let i = 0; i < 3; i++) {
    await expect(solicitarRecuperacion(user.email, { repo, enviar: roto, huella, ahora, crearToken: () => `${i}`.repeat(64) })).rejects.toThrow("Resend caído");
  }
  const filas = await estado.base.prisma.passwordReset.findMany({ where: { userId: user.id } });
  expect(filas).toHaveLength(1);
  expect(filas[0].tokenHash).toBe(await hashTokenCuenta(token));
  expect(filas[0].usadoEn).toBeNull();
  // Y el cupo sigue disponible: tres fallos no cuentan.
  const ok = vi.fn().mockResolvedValue(undefined);
  await solicitarRecuperacion(user.email, { repo, enviar: ok, huella, ahora, crearToken: () => "b".repeat(64) });
  expect(ok).toHaveBeenCalledTimes(1);
});

it("bloqueo por IP: al umbral de pedidos en 15 minutos, la IP deja de poder pedir aunque el email exista", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  const enviar = vi.fn().mockResolvedValue(undefined);
  for (let i = 0; i < UMBRAL_INTENTOS; i++) {
    await solicitarRecuperacion(`nadie-${i}@example.test`, { repo, enviar, huella, ahora: new Date(ahora.getTime() + i * 1000) });
  }
  expect(enviar).not.toHaveBeenCalled();
  await solicitarRecuperacion(user.email, { repo, enviar, huella, ahora: new Date(ahora.getTime() + 10_000) });
  expect(enviar).not.toHaveBeenCalled();
  expect(await estado.base.prisma.intentoAcceso.count({ where: { tipo: "recuperar", clave: `recuperar-ip:${huella.ip}` } })).toBe(UMBRAL_INTENTOS);
  // Otra IP sí puede.
  await solicitarRecuperacion(user.email, { repo, enviar, huella: { ip: "198.51.100.9", userAgent: null }, ahora });
  expect(enviar).toHaveBeenCalledTimes(1);
});

it("dos consumos simultáneos cambian la contraseña una sola vez y cierran todas las sesiones", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  const sesion = await crearSesion(estado.base.db, { userId: user.id, ip: null, userAgent: null, ahora: new Date() });
  await solicitarRecuperacion(user.email, { repo, enviar: vi.fn().mockResolvedValue(undefined), huella, ahora, crearToken: () => token });

  const resultados = await Promise.allSettled(["contraseña nueva A", "contraseña nueva B"].map((password) => restablecerCuenta({ token, password }, { repo, ahora, ...deps })));
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const guardado = await estado.base.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare("contraseña anterior", guardado.hashedPassword)).toBe(false);
  expect(await estado.base.prisma.passwordReset.count({ where: { userId: user.id, usadoEn: null } })).toBe(0);
  expect(await buscarSesionViva(estado.base.db, sesion.token, new Date())).toBeNull();
  const cerrada = await estado.base.prisma.sesionAcceso.findUniqueOrThrow({ where: { id: sesion.id } });
  expect(cerrada.motivoCierre).toBe("restablecimiento");
});

it("una reserva cuyo correo no se confirmó no sirve para restablecer", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  const reserva = await repo.reservarSolicitud(user.email, await hashTokenCuenta(token), ahora);
  expect(reserva).not.toBeNull();
  await expect(restablecerCuenta({ token, password: "contraseña nueva" }, { repo, ahora, ...deps })).rejects.toMatchObject({ status: 400 });
  const guardado = await estado.base.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare("contraseña anterior", guardado.hashedPassword)).toBe(true);
});

it("POST /api/cuenta/restablecer cambia la contraseña y deja el evento; el enlace no se reutiliza", async () => {
  const user = await usuaria();
  const repo = repositorioRecuperacion(estado.base.db);
  // La ruta usa la hora real: el enlace se crea ahora, no en la fecha fija.
  await solicitarRecuperacion(user.email, { repo, enviar: vi.fn().mockResolvedValue(undefined), huella, ahora: new Date(), crearToken: () => token });
  const { POST } = await import("@/app/api/cuenta/restablecer/route");
  const res = await POST(new Request("http://localhost/api/cuenta/restablecer", { method: "POST", body: JSON.stringify({ token, password: "contraseña del enlace" }) }));
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
  const guardado = await estado.base.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare("contraseña del enlace", guardado.hashedPassword)).toBe(true);
  expect(await estado.base.prisma.eventoAuditoria.count({ where: { accion: "cuenta.restablecer", actorId: user.id } })).toBe(1);
  const otra = await POST(new Request("http://localhost/api/cuenta/restablecer", { method: "POST", body: JSON.stringify({ token, password: "otra contraseña más" }) }));
  expect(otra.status).toBe(400);
});

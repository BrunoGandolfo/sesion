import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { conectarBaseDeTest, vaciarTablas } from "./db-test";
import { repositorioRecuperacion } from "@/lib/cuenta-recuperacion-db";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { restablecerCuenta } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { BCRYPT_RONDAS } from "@/lib/password";
let prisma: PrismaClient;
const sesion = vi.hoisted(() => ({ organizationId: "", userId: "" }));
vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => sesion.organizationId,
  getServerSession: async () => ({ ...sesion, user: { id: sesion.userId, organizationId: sesion.organizationId } }),
}));
// Las rutas ejercitan la base real validada por db-test, incluida la auditoría.
vi.mock("@/lib/db", () => ({ get db() { return prisma; } }));
vi.mock("@/lib/db-auth", () => ({ get dbAuth() { return prisma; } }));
const claveAnterior = process.env.NOTES_ENCRYPTION_KEY;
const ahora = new Date("2026-09-10T12:00:00Z");
const token = "a".repeat(64);
beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  prisma = conectarBaseDeTest().prisma;
});
beforeEach(() => vaciarTablas(prisma));
afterAll(async () => {
  await prisma?.$disconnect();
  if (claveAnterior === undefined) delete process.env.NOTES_ENCRYPTION_KEY; else process.env.NOTES_ENCRYPTION_KEY = claveAnterior;
});
async function usuaria() {
  const org = await prisma.organization.create({ data: { nombre: "Consultorio de test" } });
  return prisma.user.create({ data: { organizationId: org.id, email: "colega@example.test", nombre: "Colega", hashedPassword: await bcrypt.hash("contraseña anterior", BCRYPT_RONDAS) } });
}
it("el límite de 3 por hora resiste pedidos paralelos e invalida los anteriores", async () => {
  const user = await usuaria(); const repo = repositorioRecuperacion(prisma);
  const resultados = await Promise.all(Array.from({ length: 5 }, (_, i) => repo.crearSolicitud(user.email, `${i}`.repeat(64), ahora)));
  expect(resultados.filter(Boolean)).toHaveLength(3);
  const filas = await prisma.passwordReset.findMany({ where: { userId: user.id } });
  expect(filas).toHaveLength(3); expect(filas.filter(f => f.usedAt === null)).toHaveLength(1);
  expect(await repo.crearSolicitud(user.email, "f".repeat(64), new Date(ahora.getTime() + 3600001))).not.toBeNull();
});
it("dos consumos simultáneos cambian la contraseña una sola vez", async () => {
  const user = await usuaria(); const repo = repositorioRecuperacion(prisma);
  await repo.crearSolicitud(user.email, await hashTokenCuenta(token), ahora);
  const deps = { repo, ahora, comparar: bcrypt.compare, hashear: (p: string) => bcrypt.hash(p, BCRYPT_RONDAS) };
  const resultados = await Promise.allSettled(["contraseña nueva A", "contraseña nueva B"].map(password => restablecerCuenta({ token, password }, deps)));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const guardado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare("contraseña anterior", guardado.hashedPassword)).toBe(false);
  expect(await prisma.passwordReset.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
});
it("cambiar por la ruta autenticada invalida el enlace previo y conserva la contraseña nueva", async () => {
  const user = await usuaria();
  Object.assign(sesion, { userId: user.id, organizationId: user.organizationId });
  const emitido = new Date();
  const repo = repositorioRecuperacion(prisma);
  await repo.crearSolicitud(user.email, await hashTokenCuenta(token), emitido);
  const enlace = await prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: await hashTokenCuenta(token) } });
  expect(enlace.usedAt).toBeNull();
  expect(enlace.expiresAt.getTime()).toBeGreaterThan(Date.now());

  const cambiar = (await import("@/app/api/cuenta/password/route")).POST;
  const restablecer = (await import("@/app/api/cuenta/restablecer/route")).POST;
  const respuesta = await cambiar(new Request("http://localhost/api/cuenta/password", {
    method: "POST", body: JSON.stringify({ actual: "contraseña anterior", nueva: "contraseña elegida" }),
  }));
  expect(respuesta.status).toBe(200);
  const consumido = await prisma.passwordReset.findUniqueOrThrow({ where: { id: enlace.id } });
  expect(consumido.usedAt?.getTime()).toBeGreaterThanOrEqual(emitido.getTime());
  expect(consumido.expiresAt.getTime()).toBeGreaterThan(Date.now());
  const intento = await restablecer(new Request("http://localhost/api/cuenta/restablecer", {
    method: "POST", body: JSON.stringify({ token, password: "contraseña del enlace" }),
  }));
  expect(intento.status).toBe(400);
  const guardado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare("contraseña elegida", guardado.hashedPassword)).toBe(true);
  expect(await bcrypt.compare("contraseña del enlace", guardado.hashedPassword)).toBe(false);
});
it("el SQL inverso revierte la tabla dentro de una transacción que luego deshacemos", async () => {
  const inversa = readFileSync("prisma/migrations/20260909193000_password_reset/rollback.sql", "utf8");
  await expect(prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(inversa);
    const filas = await tx.$queryRaw<{ tabla: string | null }[]>`SELECT to_regclass('password_resets')::text AS tabla`;
    expect(filas[0].tabla).toBeNull();
    throw new Error("deshacer-verificacion");
  })).rejects.toThrow("deshacer-verificacion");
  expect(await prisma.passwordReset.count()).toBe(0);
});

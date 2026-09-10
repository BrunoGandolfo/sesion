import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { crearInvitacion, registrarCuenta } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { BCRYPT_RONDAS } from "@/lib/password";
const sesion = vi.hoisted(() => ({ organizationId: "", userId: "" }));
vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => sesion.organizationId,
  getServerSession: async () => ({ ...sesion, user: { id: sesion.userId, organizationId: sesion.organizationId } }),
}));
let prisma: PrismaClient; let db: ClienteCifrado;
let patchPaciente: typeof import("@/app/api/pacientes/[id]/route").PATCH;
const claveAnterior = process.env.NOTES_ENCRYPTION_KEY;
const ahora = new Date("2026-09-10T12:00:00Z");
beforeAll(async () => {
  process.env.NOTES_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  ({ prisma, db } = conectarBaseDeTest());
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  patchPaciente = (await import("@/app/api/pacientes/[id]/route")).PATCH;
});
beforeEach(() => vaciarTablas(prisma));
afterAll(async () => {
  await prisma?.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma;
  if (claveAnterior === undefined) delete process.env.NOTES_ENCRYPTION_KEY; else process.env.NOTES_ENCRYPTION_KEY = claveAnterior;
});
async function preparar() {
  const org = await prisma.organization.create({ data: { nombre: "Consultorio invitante" } });
  const invitante = await prisma.user.create({ data: { organizationId: org.id, nombre: "Invitante", email: "invitante@example.test", hashedPassword: "hash" } });
  const repo = repositorioRegistro(prisma);
  const enlace = await crearInvitacion(invitante.id, repo, ahora);
  const token = new URL(enlace.enlace).searchParams.get("token")!;
  return { org, invitante, repo, token };
}
const datos = { nombre: "Colega", email: "colega@example.test", password: "contraseña larga", aceptaTerminos: true };
const hashear = (password: string) => bcrypt.hash(password, BCRYPT_RONDAS);
it("crea un inquilino propio y su sesión no permite editar pacientes del invitante", async () => {
  const { org, repo, token } = await preparar();
  const paciente = await prisma.paciente.create({ data: { organizationId: org.id, nombre: "Paciente", apellido: "Test", telefono: "", tarifa: 1000 } });
  const nuevo = await registrarCuenta({ ...datos, token }, { repo, hashear, ahora });
  expect(nuevo.organizationId).not.toBe(org.id);
  const config = await prisma.configuracion.findUniqueOrThrow({ where: { organizationId: nuevo.organizationId } });
  expect(config.tarifaDefault).toBe(0); expect(config.nombreProfesional).toBe(""); expect(config.direccion).toBe("");
  const usuario = await prisma.user.findUniqueOrThrow({ where: { id: nuevo.userId } });
  expect(await bcrypt.compare(datos.password, usuario.hashedPassword)).toBe(true);
  const evento = await prisma.eventoAuditoria.findFirstOrThrow({ where: { organizationId: nuevo.organizationId, accion: "cuenta.registro" } });
  expect(evento.detalle).toMatchObject({ aceptaTerminos: true });
  expect(JSON.stringify(evento.detalle)).not.toContain(datos.email); expect(JSON.stringify(evento.detalle)).not.toContain(token);
  Object.assign(sesion, nuevo);
  const respuesta = await patchPaciente(new Request(`http://localhost/api/pacientes/${paciente.id}`, { method: "PATCH", body: JSON.stringify({ nombre: "No debe cambiar" }) }), { params: Promise.resolve({ id: paciente.id }) });
  expect(respuesta.status).toBe(404);
  expect((await prisma.paciente.findUniqueOrThrow({ where: { id: paciente.id } })).nombre).toBe("Paciente");
  expect(await prisma.paciente.count({ where: { organizationId: nuevo.organizationId } })).toBe(0);
  await expect(registrarCuenta({ ...datos, email: "otra@example.test", token }, { repo, hashear, ahora })).rejects.toMatchObject({ status: 400 });
});
it("una invitación simultánea sólo crea una organización", async () => {
  const { repo, token } = await preparar();
  const resultados = await Promise.allSettled(["una@example.test", "otra@example.test"].map(email => registrarCuenta({ ...datos, email, token }, { repo, hashear, ahora })));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.organization.count()).toBe(2); expect(await prisma.configuracion.count()).toBe(1);
});
it("email repetido no consume la invitación ni crea un consultorio", async () => {
  const { repo, token, invitante } = await preparar();
  await expect(registrarCuenta({ ...datos, email: invitante.email, token }, { repo, hashear, ahora })).rejects.toMatchObject({ status: 400 });
  expect(await prisma.organization.count()).toBe(1);
  expect((await prisma.invitacion.findUniqueOrThrow({ where: { tokenHash: await hashTokenCuenta(token) } })).usedAt).toBeNull();
});
it("un fallo después de crear la organización revierte también el consumo", async () => {
  const { repo, token } = await preparar();
  const invitacion = await prisma.invitacion.findUniqueOrThrow({ where: { tokenHash: await hashTokenCuenta(token) } });
  // Falla user.create por falta de hash, después de organization.create.
  await expect(repo.registrar({ invitacionId: invitacion.id, nombre: datos.nombre, email: datos.email, hashedPassword: undefined as unknown as string, ahora })).rejects.toThrow();
  expect(await prisma.organization.count()).toBe(1); expect(await prisma.configuracion.count()).toBe(0);
  expect((await prisma.invitacion.findUniqueOrThrow({ where: { id: invitacion.id } })).usedAt).toBeNull();
});
it("el SQL inverso elimina sólo invitaciones y puede deshacerse", async () => {
  await preparar();
  const inversa = readFileSync("prisma/migrations/20260909194000_invitaciones/rollback.sql", "utf8");
  await expect(prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(inversa);
    expect(await tx.organization.count()).toBe(1);
    throw Error("deshacer-verificacion");
  })).rejects.toThrow("deshacer-verificacion");
  expect(await prisma.invitacion.count()).toBe(1);
});

import { afterEach, expect, it, vi } from "vitest";

import {
  crearInvitacion,
  invitacionDisponible,
  MAX_INVITACIONES_VIGENTES,
  puedeInvitar,
  registrarCuenta,
  type InvitacionGuardada,
  type RepositorioRegistro,
} from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { ApiError } from "@/app/api/_lib/responses";
import { ENTRADA_REGISTRO_ERROR } from "@/lib/glosario";

const ahora = new Date("2026-09-10T12:00:00Z");
const actor = { userId: "duena", email: "mariana@example.test", rol: "titular" };
const datos = { token: "a".repeat(64), email: " Nueva@example.test ", nombre: " Nueva Colega ", password: "contraseña larga", aceptaTerminos: true };
const huella = { ip: "203.0.113.7", userAgent: "vitest" };
const hashTokenSesion = async (t: string) => `hash(${t})`;

function preparar(cambios: Partial<InvitacionGuardada> = {}, vigentes = 0) {
  const invitacion: InvitacionGuardada = { id: "invitacion", creadaPorId: "duena", venceEn: new Date(ahora.getTime() + 10000), usadaEn: null, ...cambios };
  const repo: RepositorioRegistro = {
    contarVigentes: vi.fn().mockResolvedValue(vigentes),
    crearInvitacion: vi.fn().mockResolvedValue({ id: "inv-nueva" }),
    buscarInvitacion: vi.fn().mockResolvedValue(invitacion),
    registrar: vi.fn().mockResolvedValue({ userId: "nueva", organizationId: "nuevo-consultorio", sesionId: "ses" }),
  };
  return { repo, ahora, hashear: vi.fn().mockResolvedValue("hash-password"), tokenSesion: "t".repeat(43), huella, hashTokenSesion };
}

const ORIGINAL = process.env.INVITACIONES_PERMITIDAS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.INVITACIONES_PERMITIDAS; else process.env.INVITACIONES_PERMITIDAS = ORIGINAL;
});

it("puedeInvitar: rol titular y email en INVITACIONES_PERMITIDAS; sin la variable nadie", () => {
  expect(puedeInvitar(actor, "mariana@example.test")).toBe(true);
  expect(puedeInvitar(actor, " Otra@example.test , MARIANA@example.test ")).toBe(true);
  expect(puedeInvitar(actor, "otra@example.test")).toBe(false);
  expect(puedeInvitar({ ...actor, rol: "otro" }, "mariana@example.test")).toBe(false);
  expect(puedeInvitar(actor, undefined)).toBe(false);
  expect(puedeInvitar(actor, "")).toBe(false);
});

it("crea un enlace canónico de 7 días, guardando sólo el hash", async () => {
  process.env.INVITACIONES_PERMITIDAS = actor.email;
  const deps = preparar();
  const resultado = await crearInvitacion(actor, deps.repo, ahora);
  expect(resultado.enlace).toMatch(/^https:\/\/sesionapp.app\/registro\?token=[a-f0-9]{64}$/);
  expect(resultado.vence).toBe("2026-09-17T12:00:00.000Z");
  expect(resultado.invitacionId).toBe("inv-nueva");
  const guardado = vi.mocked(deps.repo.crearInvitacion).mock.calls[0][0];
  expect(guardado.creadaPorId).toBe("duena");
  expect(resultado.enlace).not.toContain(guardado.tokenHash);
});

it("sin permiso: 403 y no crea nada", async () => {
  process.env.INVITACIONES_PERMITIDAS = "otra@example.test";
  const deps = preparar();
  await expect(crearInvitacion(actor, deps.repo, ahora)).rejects.toMatchObject({ status: 403 });
  expect(deps.repo.crearInvitacion).not.toHaveBeenCalled();
});

it(`con ${MAX_INVITACIONES_VIGENTES} vigentes: 429 y no crea nada`, async () => {
  process.env.INVITACIONES_PERMITIDAS = actor.email;
  const deps = preparar({}, MAX_INVITACIONES_VIGENTES);
  await expect(crearInvitacion(actor, deps.repo, ahora)).rejects.toMatchObject({ status: 429 });
  expect(deps.repo.crearInvitacion).not.toHaveBeenCalled();
  expect(MAX_INVITACIONES_VIGENTES).toBe(2);
});

it("registra con email y nombre normalizados, password hasheada y la sesión nueva", async () => {
  const deps = preparar();
  expect(await registrarCuenta(datos, deps)).toEqual({ userId: "nueva", organizationId: "nuevo-consultorio", sesionId: "ses" });
  expect(deps.repo.registrar).toHaveBeenCalledWith({
    invitacionId: "invitacion", nombre: "Nueva Colega", email: "nueva@example.test", hashedPassword: "hash-password", ahora,
    sesion: { tokenHash: `hash(${"t".repeat(43)})`, ip: huella.ip, userAgent: huella.userAgent },
  });
});

it.each([{ usadaEn: ahora }, { venceEn: ahora }])("rechaza una invitación no disponible: %j", async (cambios) => {
  const deps = preparar(cambios);
  await expect(registrarCuenta(datos, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.registrar).not.toHaveBeenCalled();
  expect(await invitacionDisponible(datos.token, deps.repo, ahora)).toBeNull();
});

it("sin términos no consume la invitación ni hashea", async () => {
  const deps = preparar();
  await expect(registrarCuenta({ ...datos, aceptaTerminos: false }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).not.toHaveBeenCalled();
});

it("email repetido devuelve el error neutro", async () => {
  const deps = preparar();
  vi.mocked(deps.repo.registrar).mockRejectedValue(new ApiError(ENTRADA_REGISTRO_ERROR, 400));
  await expect(registrarCuenta(datos, deps)).rejects.toMatchObject({ message: ENTRADA_REGISTRO_ERROR });
});

it.each([{ token: "inválido" }, { password: "corta" }, { email: "no-email" }, { nombre: " " }])("valida los datos antes de crear filas: %j", async (cambio) => {
  const deps = preparar();
  await expect(registrarCuenta({ ...datos, ...cambio }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.registrar).not.toHaveBeenCalled();
});

import { expect, it, vi } from "vitest";
import { crearInvitacion, registrarCuenta, type RepositorioRegistro, type InvitacionGuardada } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { ApiError } from "@/app/api/_lib/responses";
import { ENTRADA_REGISTRO_ERROR } from "@/lib/glosario";
const ahora = new Date("2026-09-10T12:00:00Z");
const datos = { token: "a".repeat(64), email: " Nueva@example.test ", nombre: " Nueva Colega ", password: "contraseña larga", aceptaTerminos: true };
function preparar(cambios: Partial<InvitacionGuardada> = {}) {
  const invitacion: InvitacionGuardada = { id: "invitacion", organizationId: null, email: null, expiresAt: new Date(ahora.getTime() + 10000), usedAt: null, ...cambios };
  const repo: RepositorioRegistro = {
    crearInvitacion: vi.fn().mockResolvedValue(undefined), buscarInvitacion: vi.fn().mockResolvedValue(invitacion),
    registrar: vi.fn().mockResolvedValue({ userId: "nueva", organizationId: "nuevo-consultorio" }),
  };
  return { repo, ahora, hashear: vi.fn().mockResolvedValue("hash-password") };
}
it("crea un enlace canónico de 7 días, guardando sólo el hash", async () => {
  const deps = preparar(); const resultado = await crearInvitacion("dueña", deps.repo, ahora);
  expect(resultado.enlace).toMatch(/^https:\/\/sesionapp.app\/registro\?token=[a-f0-9]{64}$/);
  expect(resultado.vence).toBe("2026-09-17T12:00:00.000Z");
  const guardado = vi.mocked(deps.repo.crearInvitacion).mock.calls[0][0];
  expect(resultado.enlace).not.toContain(guardado.tokenHash);
});
it("registra con email y nombre normalizados y password hasheada", async () => {
  const deps = preparar();
  expect(await registrarCuenta(datos, deps)).toEqual({ userId: "nueva", organizationId: "nuevo-consultorio" });
  expect(deps.repo.registrar).toHaveBeenCalledWith({ invitacionId: "invitacion", nombre: "Nueva Colega", email: "nueva@example.test", hashedPassword: "hash-password", ahora });
});
it.each([{ usedAt: ahora }, { expiresAt: ahora }, { organizationId: "consultorio-ajeno" }, { email: "otra@example.test" }])("rechaza una invitación no disponible: %j", async cambios => {
  const deps = preparar(cambios);
  await expect(registrarCuenta(datos, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.registrar).not.toHaveBeenCalled();
});
it("sin términos no consume la invitación ni hashea", async () => {
  const deps = preparar();
  await expect(registrarCuenta({ ...datos, aceptaTerminos: false }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).not.toHaveBeenCalled();
});
it("email repetido devuelve el error neutro", async () => {
  const deps = preparar(); vi.mocked(deps.repo.registrar).mockRejectedValue(new ApiError(ENTRADA_REGISTRO_ERROR, 400));
  await expect(registrarCuenta(datos, deps)).rejects.toMatchObject({ message: ENTRADA_REGISTRO_ERROR });
});
it.each([{ token: "inválido" }, { password: "corta" }, { email: "no-email" }, { nombre: " " }])("valida los datos antes de crear filas: %j", async cambio => {
  const deps = preparar();
  await expect(registrarCuenta({ ...datos, ...cambio }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.registrar).not.toHaveBeenCalled();
});

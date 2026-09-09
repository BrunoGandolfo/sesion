import { expect, it, vi } from "vitest";
import { solicitarRecuperacion, restablecerCuenta, type ResetGuardado, type RepositorioRecuperacion } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { hashTokenCuenta, nuevoTokenCuenta, TOKEN_CUENTA } from "@/lib/cuenta-tokens";
const token = "a".repeat(64);
const ahora = new Date("2026-09-10T12:00:00Z");
function preparar(cambios: Partial<ResetGuardado> = {}) {
  const fila: ResetGuardado = { id: "reset", userId: "user", organizationId: "org", hashedPassword: "hash-viejo", expiresAt: new Date(ahora.getTime() + 1000), usedAt: null, ...cambios };
  const repo: RepositorioRecuperacion = {
    crearSolicitud: vi.fn().mockResolvedValue({ email: "colega@example.test" }),
    buscar: vi.fn().mockImplementation(async () => fila),
    consumir: vi.fn().mockImplementation(async () => { if (fila.usedAt) return false; fila.usedAt = ahora; return true; }),
  };
  return { repo, ahora, hashear: vi.fn().mockResolvedValue("hash-nuevo"), comparar: vi.fn().mockResolvedValue(false) };
}
it("genera 32 bytes aleatorios y un hash diferente del token", async () => {
  const primero = nuevoTokenCuenta();
  expect(TOKEN_CUENTA.test(primero)).toBe(true);
  expect(nuevoTokenCuenta()).not.toBe(primero);
  expect(await hashTokenCuenta(primero)).not.toBe(primero);
});
it("normaliza el email, guarda sólo el hash y manda el enlace canónico", async () => {
  const { repo } = preparar(); const enviar = vi.fn();
  await solicitarRecuperacion(" COLEGA@example.test ", { repo, enviar, ahora, crearToken: () => token });
  expect(repo.crearSolicitud).toHaveBeenCalledWith("colega@example.test", await hashTokenCuenta(token), ahora);
  expect(enviar.mock.calls[0][0].texto).toContain(`https://sesionapp.app/restablecer?token=${token}`);
});
it("sin cuenta o con cuota agotada no manda correo", async () => {
  const { repo } = preparar(); vi.mocked(repo.crearSolicitud).mockResolvedValue(null);
  const enviar = vi.fn(); await solicitarRecuperacion("nadie@example.test", { repo, enviar });
  expect(enviar).not.toHaveBeenCalled();
});
it("restablece una vez y rechaza reutilizarlo", async () => {
  const deps = preparar();
  expect(await restablecerCuenta({ token, password: "contraseña nueva" }, deps)).toEqual({ userId: "user", organizationId: "org" });
  await expect(restablecerCuenta({ token, password: "otra contraseña" }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).toHaveBeenCalledTimes(1);
});
it.each([{ expiresAt: ahora }, { usedAt: ahora }])("rechaza vencido o usado sin hashear: %j", async cambios => {
  const deps = preparar(cambios);
  await expect(restablecerCuenta({ token, password: "contraseña nueva" }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).not.toHaveBeenCalled();
});
it.each(["corta", " ".repeat(10), "ñ".repeat(37)])("rechaza contraseña débil o fuera de política", async password => {
  const deps = preparar();
  await expect(restablecerCuenta({ token, password }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.consumir).not.toHaveBeenCalled();
});
it("rechaza contraseña igual a la actual", async () => {
  const deps = preparar(); deps.comparar.mockResolvedValue(true);
  await expect(restablecerCuenta({ token, password: "contraseña actual" }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.repo.consumir).not.toHaveBeenCalled();
});
it("rechaza si otro pedido consumió el token entre la lectura y el cambio", async () => {
  const deps = preparar(); vi.mocked(deps.repo.consumir).mockResolvedValue(false);
  await expect(restablecerCuenta({ token, password: "contraseña nueva" }, deps)).rejects.toMatchObject({ status: 400 });
});

import { expect, it, vi } from "vitest";

import {
  restablecerCuenta,
  solicitarRecuperacion,
  type RepositorioRecuperacion,
  type ResetGuardado,
} from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { hashTokenCuenta, nuevoTokenCuenta, TOKEN_CUENTA } from "@/lib/cuenta-tokens";

const token = "a".repeat(64);
const ahora = new Date("2026-09-10T12:00:00Z");
const huella = { ip: "203.0.113.7", userAgent: "vitest" };

function preparar(cambios: Partial<ResetGuardado> = {}) {
  const fila: ResetGuardado = {
    id: "reset", userId: "user", organizationId: "org", hashedPassword: "hash-viejo",
    venceEn: new Date(ahora.getTime() + 1000), usadoEn: null, enviadoEn: ahora, ...cambios,
  };
  const repo: RepositorioRecuperacion = {
    registrarPedido: vi.fn().mockResolvedValue({ bloqueado: false }),
    reservarSolicitud: vi.fn().mockResolvedValue({ resetId: "reset", userId: "user", email: "colega@example.test" }),
    confirmarEnvio: vi.fn().mockResolvedValue(undefined),
    descartarSolicitud: vi.fn().mockResolvedValue(undefined),
    buscar: vi.fn().mockImplementation(async () => fila),
    consumir: vi.fn().mockImplementation(async () => { if (fila.usadoEn) return false; fila.usadoEn = ahora; return true; }),
  };
  return { repo, ahora, hashear: vi.fn().mockResolvedValue("hash-nuevo"), comparar: vi.fn().mockResolvedValue(false) };
}

it("genera 32 bytes aleatorios y un hash diferente del token", async () => {
  const primero = nuevoTokenCuenta();
  expect(TOKEN_CUENTA.test(primero)).toBe(true);
  expect(nuevoTokenCuenta()).not.toBe(primero);
  expect(await hashTokenCuenta(primero)).not.toBe(primero);
});

it("orden nuevo: IP, reserva, correo, confirmación; el enlace es canónico y sólo viaja el hash", async () => {
  const { repo } = preparar(); const enviar = vi.fn().mockResolvedValue(undefined);
  await solicitarRecuperacion(" COLEGA@example.test ", { repo, enviar, huella, ahora, crearToken: () => token });
  expect(repo.registrarPedido).toHaveBeenCalledWith(huella, ahora);
  expect(repo.reservarSolicitud).toHaveBeenCalledWith("colega@example.test", await hashTokenCuenta(token), ahora);
  expect(enviar.mock.calls[0][0].texto).toContain(`https://sesionapp.app/restablecer?token=${token}`);
  expect(repo.confirmarEnvio).toHaveBeenCalledWith("reset", "user", ahora);
  expect(repo.descartarSolicitud).not.toHaveBeenCalled();
  const orden = [repo.registrarPedido, repo.reservarSolicitud, enviar, repo.confirmarEnvio].map((f) => vi.mocked(f).mock.invocationCallOrder[0]);
  expect([...orden].sort((a, b) => a - b)).toEqual(orden);
});

it("IP bloqueada: no busca la cuenta ni manda nada", async () => {
  const { repo } = preparar(); vi.mocked(repo.registrarPedido).mockResolvedValue({ bloqueado: true });
  const enviar = vi.fn();
  await solicitarRecuperacion("colega@example.test", { repo, enviar, huella, ahora });
  expect(repo.reservarSolicitud).not.toHaveBeenCalled();
  expect(enviar).not.toHaveBeenCalled();
});

it("sin cuenta o con cupo agotado no manda correo", async () => {
  const { repo } = preparar(); vi.mocked(repo.reservarSolicitud).mockResolvedValue(null);
  const enviar = vi.fn(); await solicitarRecuperacion("nadie@example.test", { repo, enviar, huella });
  expect(enviar).not.toHaveBeenCalled();
  expect(repo.confirmarEnvio).not.toHaveBeenCalled();
});

it("si el correo falla, descarta la reserva y NO confirma: los enlaces anteriores siguen vivos", async () => {
  const { repo } = preparar(); const enviar = vi.fn().mockRejectedValue(new Error("Resend caído"));
  await expect(solicitarRecuperacion("colega@example.test", { repo, enviar, huella, ahora })).rejects.toThrow("Resend caído");
  expect(repo.descartarSolicitud).toHaveBeenCalledWith("reset");
  expect(repo.confirmarEnvio).not.toHaveBeenCalled();
});

it("restablece una vez y rechaza reutilizarlo", async () => {
  const deps = preparar();
  expect(await restablecerCuenta({ token, password: "contraseña nueva" }, deps)).toEqual({ userId: "user", organizationId: "org" });
  await expect(restablecerCuenta({ token, password: "otra contraseña" }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).toHaveBeenCalledTimes(1);
});

it.each([{ venceEn: ahora }, { usadoEn: ahora }, { enviadoEn: null }])("rechaza vencido, usado o sin correo enviado, sin hashear: %j", async (cambios) => {
  const deps = preparar(cambios);
  await expect(restablecerCuenta({ token, password: "contraseña nueva" }, deps)).rejects.toMatchObject({ status: 400 });
  expect(deps.hashear).not.toHaveBeenCalled();
});

it.each(["corta", " ".repeat(10), "ñ".repeat(37)])("rechaza contraseña débil o fuera de política", async (password) => {
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

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RecuperarPage from "@/app/(auth)/recuperar/page";
import { RestablecerForm } from "@/app/(auth)/restablecer/restablecer-form";
import { ENTRADA_EMAIL, ENTRADA_CONTRASENA, ENTRADA_REPETIR, ENTRADA_RECUPERAR_BOTON, ENTRADA_RECUPERAR_ENVIADO, ENTRADA_RESTABLECER, ENTRADA_PASSWORD_NO_COINCIDE } from "@/lib/glosario";
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("recuperar muestra la confirmación neutra y conserva la presencia", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} })); vi.stubGlobal("fetch", fetcher);
  render(<RecuperarPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Sesión" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(ENTRADA_EMAIL), { target: { value: "colega@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: ENTRADA_RECUPERAR_BOTON }));
  expect((await screen.findByRole("status")).textContent).toBe(ENTRADA_RECUPERAR_ENVIADO);
});
it("restablecer compara las dos contraseñas y redirige al login con aviso", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { cambiada: true } })); vi.stubGlobal("fetch", fetcher);
  render(<RestablecerForm token={"a".repeat(64)} />);
  fireEvent.change(screen.getByLabelText(ENTRADA_CONTRASENA), { target: { value: "una contraseña" } });
  fireEvent.change(screen.getByLabelText(ENTRADA_REPETIR), { target: { value: "otra contraseña" } });
  fireEvent.click(screen.getByRole("button", { name: ENTRADA_RESTABLECER }));
  expect(screen.getByRole("alert").textContent).toBe(ENTRADA_PASSWORD_NO_COINCIDE);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(ENTRADA_REPETIR), { target: { value: "una contraseña" } });
  fireEvent.click(screen.getByRole("button", { name: ENTRADA_RESTABLECER }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?aviso=password-cambiada"));
});
it("sin token no permite enviar contraseñas", () => {
  render(<RestablecerForm token="" />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

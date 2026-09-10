// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegistroForm } from "@/app/(auth)/registro/registro-form";
import TerminosPage from "@/app/(auth)/terminos/page";
import { InvitarColega } from "@/app/(dashboard)/config/_components/invitar-colega";
import { signIn } from "next-auth/react";
import { ENTRADA_NOMBRE, ENTRADA_EMAIL, ENTRADA_CONTRASENA, ENTRADA_REPETIR, ENTRADA_REGISTRO, ENTRADA_ACEPTA_TERMINOS, ENTRADA_PEDIR_INVITACION, INVITAR_GENERAR, INVITAR_COPIAR, INVITAR_WHATSAPP, TERMINOS_BORRADOR } from "@/lib/glosario";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn().mockResolvedValue({ ok: true }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function completar() {
  for (const [label, value] of [[ENTRADA_NOMBRE, "Colega"], [ENTRADA_EMAIL, "colega@example.test"], [ENTRADA_CONTRASENA, "contraseña larga"], [ENTRADA_REPETIR, "contraseña larga"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
it("sin invitación válida muestra el pedido de otro enlace", () => {
  render(<RegistroForm token="" valida={false} />);
  expect(screen.getByText(ENTRADA_PEDIR_INVITACION)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("exige términos, crea cuenta e inicia sesión por credentials hacia Hoy", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { creada: true } }, { status: 201 })); vi.stubGlobal("fetch", fetcher);
  render(<RegistroForm token={"a".repeat(64)} valida />); completar();
  const boton = screen.getByRole("button", { name: ENTRADA_REGISTRO });
  fireEvent.submit(boton.closest("form")!);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: ENTRADA_ACEPTA_TERMINOS }));
  expect(screen.getByRole("link", { name: ENTRADA_ACEPTA_TERMINOS }).getAttribute("href")).toBe("/terminos");
  fireEvent.click(boton);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(signIn).toHaveBeenCalledWith("credentials", { email: "colega@example.test", password: "contraseña larga", redirect: false });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).aceptaTerminos).toBe(true);
});
it("muestra el enlace de invitación y permite copiarlo y compartirlo", async () => {
  const enlace = `https://sesionapp.app/registro?token=${"a".repeat(64)}`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { enlace } })));
  const copiar = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: copiar } });
  render(<InvitarColega />);
  fireEvent.click(screen.getByRole("button", { name: INVITAR_GENERAR }));
  fireEvent.click(await screen.findByRole("button", { name: INVITAR_COPIAR }));
  await waitFor(() => expect(copiar).toHaveBeenCalledWith(enlace));
  const whatsapp = screen.getByRole("link", { name: INVITAR_WHATSAPP });
  expect(new URL(whatsapp.getAttribute("href")!).searchParams.get("text")).toContain(enlace);
});
it("los términos son un borrador explícito y nombran los proveedores reales", () => {
  render(<TerminosPage />); expect(screen.getByText(TERMINOS_BORRADOR)).toBeTruthy();
  for (const nombre of ["Vercel", "Neon", "R2", "AssemblyAI", "Anthropic", "Twilio", "Resend"]) expect(document.body.textContent).toContain(nombre);
});

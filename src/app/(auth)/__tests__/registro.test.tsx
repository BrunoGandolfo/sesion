// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegistroForm } from "@/app/(auth)/registro/registro-form";
import TerminosPage from "@/app/(auth)/terminos/page";
import { InvitarColega } from "@/app/(dashboard)/config/_components/invitar-colega";
import { ENTRADA_NOMBRE, ENTRADA_EMAIL, ENTRADA_CONTRASENA, ENTRADA_REPETIR, ENTRADA_REGISTRO, ENTRADA_ACEPTA_TERMINOS, ENTRADA_PEDIR_INVITACION, INVITAR_GENERAR, INVITAR_COPIAR, INVITAR_WHATSAPP, INVITAR_DESCRIPCION, INVITAR_LIMITES, INVITAR_AGOTADAS, TERMINOS_BORRADOR } from "@/lib/glosario";
/** GET del cupo y POST de la invitación, cada uno con su respuesta. */
function servidor(cupo: { restantes: number; aviso: string | null }, post: Response) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST" ? post : Response.json({ data: cupo }));
}
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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
it("exige términos, crea la cuenta con UN solo POST (que deja la cookie) y va a Hoy", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { creada: true } }, { status: 201 })); vi.stubGlobal("fetch", fetcher);
  render(<RegistroForm token={"a".repeat(64)} valida />); completar();
  const boton = screen.getByRole("button", { name: ENTRADA_REGISTRO });
  fireEvent.submit(boton.closest("form")!);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: ENTRADA_ACEPTA_TERMINOS }));
  expect(screen.getByRole("link", { name: ENTRADA_ACEPTA_TERMINOS }).getAttribute("href")).toBe("/terminos");
  fireEvent.click(boton);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/cuenta/registro");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).aceptaTerminos).toBe(true);
});
it("un 403 al invitar muestra el motivo del servidor", async () => {
  vi.stubGlobal("fetch", servidor({ restantes: 5, aviso: null }, Response.json({ error: "No podés invitar desde esta cuenta." }, { status: 403 })));
  render(<InvitarColega />);
  fireEvent.click(await screen.findByRole("button", { name: INVITAR_GENERAR }));
  expect((await screen.findByRole("alert")).textContent).toBe("No podés invitar desde esta cuenta.");
});
it("muestra el enlace de invitación y permite copiarlo y compartirlo", async () => {
  const enlace = `https://sesionapp.app/registro?token=${"a".repeat(64)}`;
  vi.stubGlobal("fetch", servidor({ restantes: 5, aviso: null }, Response.json({ data: { enlace } })));
  const copiar = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: copiar } });
  render(<InvitarColega />);
  fireEvent.click(screen.getByRole("button", { name: INVITAR_GENERAR }));
  fireEvent.click(await screen.findByRole("button", { name: INVITAR_COPIAR }));
  await waitFor(() => expect(copiar).toHaveBeenCalledWith(enlace));
  const whatsapp = screen.getByRole("link", { name: INVITAR_WHATSAPP });
  expect(new URL(whatsapp.getAttribute("href")!).searchParams.get("text")).toContain(enlace);
});
it("antes de generar dice que es una prueba, los tres límites y cuántas quedan", async () => {
  vi.stubGlobal("fetch", servidor({ restantes: 4, aviso: null }, Response.json({ data: {} })));
  render(<InvitarColega />);
  expect(screen.getByText(INVITAR_DESCRIPCION)).toBeTruthy();
  expect(await screen.findByText(`${INVITAR_LIMITES} Te quedan 4 invitaciones.`)).toBeTruthy();
  expect(document.body.textContent).toContain("pruebe Sesión");
  expect(document.body.textContent).toContain("hasta 15 sesiones en total");
  expect(document.body.textContent).toContain("5 invitaciones en total, una cada 30 días");
  expect((screen.getByRole("button", { name: INVITAR_GENERAR }) as HTMLButtonElement).disabled).toBe(false);
});
it("si hay que esperar dice desde cuándo y no deja generar; sin cupo tampoco", async () => {
  const espera = "Generaste una invitación hace menos de 30 días. Vas a poder generar la próxima desde el 17 de octubre de 2026 a las 12:30.";
  const fetcher = servidor({ restantes: 3, aviso: espera }, Response.json({ data: {} }));
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<InvitarColega />);
  expect((await screen.findByRole("status")).textContent).toBe(espera);
  expect((screen.getByRole("button", { name: INVITAR_GENERAR }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: INVITAR_GENERAR }));
  expect(fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  unmount();
  vi.stubGlobal("fetch", servidor({ restantes: 0, aviso: INVITAR_AGOTADAS }, Response.json({ data: {} })));
  render(<InvitarColega />);
  expect((await screen.findByRole("status")).textContent).toBe(INVITAR_AGOTADAS);
  expect((screen.getByRole("button", { name: INVITAR_GENERAR }) as HTMLButtonElement).disabled).toBe(true);
});
it("los términos son un borrador explícito y nombran los proveedores reales", () => {
  render(<TerminosPage />); expect(screen.getByText(TERMINOS_BORRADOR)).toBeTruthy();
  for (const nombre of ["Vercel", "Neon", "R2", "AssemblyAI", "Anthropic", "Twilio", "Resend"]) expect(document.body.textContent).toContain(nombre);
});

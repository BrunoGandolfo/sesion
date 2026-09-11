// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Mariana Roldán" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ apiGet: async () => [] }));
vi.mock("@/components/ayuda/panel-ayuda", () => ({
  PanelAyuda: ({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) =>
    abierto ? <div role="dialog" aria-label="Lupita"><button onClick={alCerrar}>Cerrar</button></div> : null,
}));

describe.each([BottomNav, Sidebar])("Menú %s", (Menu) => {
  it("ofrece Lupita en quinto lugar y abre y cierra el panel", async () => {
    render(<Menu />);
    const nav = screen.getByRole("navigation");
    const lupita = within(nav).getByRole("button", { name: "Lupita" });
    expect(nav.children[4]).toBe(lupita);
    fireEvent.click(lupita);
    expect(await screen.findByRole("dialog", { name: "Lupita" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("el menú lateral enlaza Tu consultorio a configuración", async () => {
  render(<Sidebar />);
  expect((await screen.findByRole("link", { name: "Tu consultorio" })).getAttribute("href")).toBe("/config");
});

it('hace legibles los destinos inactivos sin cambiar los enlaces ni la altura de línea',()=>{
 render(<BottomNav/>);
 const agenda=screen.getByRole('link',{name:'Agenda'});
 expect(agenda.classList.contains('text-ink-500')).toBe(true);
 expect(agenda.classList.contains('text-[12px]')).toBe(true);
 expect(agenda.classList.contains('leading-[15px]')).toBe(true);
 expect(agenda.getAttribute('href')).toBe('/agenda');
 expect(screen.getByRole('button',{name:'Lupita'}).classList.contains('text-ink-500')).toBe(true);
});

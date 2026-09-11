// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

const datosMenu = vi.hoisted(() => ({ deudores: [] as Array<{ diasAtraso: number }> }));
beforeEach(() => { datosMenu.deudores = []; });

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Mariana Roldán" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ apiGet: async () => datosMenu.deudores }));
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

it('aclara que el número del menú cuenta deudas de más de treinta días', async()=>{
 datosMenu.deudores=[{diasAtraso:45},{diasAtraso:90},{diasAtraso:2}];
 render(<Sidebar/>);
 const contador=await screen.findByLabelText('2 deudores con más de 30 días');
 expect(contador.textContent).toBe('2 · +30 días');
 expect(contador.title).toBe('2 pacientes con deudas de más de 30 días');
 expect(contador.closest('a')?.getAttribute('href')).toBe('/cobros');
});

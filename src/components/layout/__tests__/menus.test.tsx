// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AyudaDelPanel } from "@/components/layout/ayuda-del-panel";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { actualizarSeguimiento, aplicarRespuesta, olvidarNotas } from "@/lib/notas-en-proceso";

const datosMenu = vi.hoisted(() => ({
  deudores: [] as Array<{ diasAtraso: number }>,
  ruta: "/",
  escritorio: true,
}));
const apiGet = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<Array<{ diasAtraso: number }>>>(async () => datosMenu.deudores),
);

beforeEach(() => {
  datosMenu.deudores = [];
  datosMenu.ruta = "/";
  datosMenu.escritorio = true;
  apiGet.mockClear();
  // El ancho: jsdom no trae matchMedia. `lg` es 64rem.
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta === "(min-width: 64rem)" && datosMenu.escritorio,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => olvidarNotas());
});

vi.mock("next/navigation", () => ({ usePathname: () => datosMenu.ruta }));
vi.mock("@/components/layout/providers", () => ({
  useSesionActual: () => ({ nombre: "Mariana Roldán", email: "mariana@example.test" }),
}));
vi.mock("@/lib/sesion-cliente", () => ({ cerrarSesion: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiGet }));

// El panel queda montado aunque esté cerrado (como el de verdad, que
// conserva la conversación): se cuenta con `hidden: true`.
vi.mock("@/components/ayuda/panel-ayuda", () => ({
  PanelAyuda: ({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) => (
    <div role="dialog" aria-label="Lupita" hidden={!abierto}>
      <button onClick={alCerrar}>Cerrar</button>
    </div>
  ),
}));

function conPanel(ui: React.ReactElement) {
  return <AyudaDelPanel>{ui}</AyudaDelPanel>;
}

describe.each([BottomNav, Sidebar])("Menú %s", (Menu) => {
  it("ofrece Lupita en quinto lugar y abre y cierra el panel", async () => {
    render(conPanel(<Menu />));
    const nav = screen.getByRole("navigation");
    const lupita = within(nav).getByRole("button", { name: "Lupita" });
    expect(nav.children[4]).toBe(lupita);
    fireEvent.click(lupita);
    expect(await screen.findByRole("dialog", { name: "Lupita" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marca Hoy con el número de notas sin ver, y sin avisos no marca nada", () => {
    render(conPanel(<Menu />));
    expect(screen.getByRole("link", { name: "Hoy" })).toBeTruthy();
    act(() =>
      actualizarSeguimiento((s) =>
        aplicarRespuesta(s, [
          { id: "s1", paciente: "Lucía Fernández", estado: "revision", fecha: "2026-09-23T13:00:00.000Z" },
          { id: "s2", paciente: "Ana Pérez", estado: "fallida", fecha: "2026-09-23T14:00:00.000Z" },
          { id: "s3", paciente: "Marta Silva", estado: "procesando", fecha: "2026-09-23T15:00:00.000Z" },
        ], Date.now()),
      ),
    );
    const hoy = screen.getByRole("link", { name: "Hoy, 2 notas para mirar" });
    expect(hoy.getAttribute("href")).toBe("/");
    expect(hoy.textContent).toContain("2");
  });
});

it("con los dos menús montados, como en el layout, hay un solo panel de ayuda", () => {
  render(
    conPanel(
      <>
        <Sidebar />
        <BottomNav />
      </>,
    ),
  );
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
  // Los dos Lupita abren el mismo.
  const [lateral, abajo] = screen
    .getAllByRole("navigation")
    .map((nav) => within(nav).getByRole("button", { name: "Lupita" }));
  fireEvent.click(abajo);
  expect(screen.getAllByRole("dialog", { name: "Lupita" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
  fireEvent.click(lateral);
  expect(screen.getAllByRole("dialog", { name: "Lupita" })).toHaveLength(1);
});

it("en el teléfono el menú lateral oculto no pide /api/deudores al navegar", async () => {
  datosMenu.escritorio = false;
  const { rerender } = render(conPanel(<Sidebar />));
  for (const ruta of ["/agenda", "/cobros", "/pacientes", "/"]) {
    datosMenu.ruta = ruta;
    rerender(conPanel(<Sidebar />));
    await act(async () => {});
  }
  expect(apiGet).not.toHaveBeenCalled();
});

it("en la computadora lo pide, y otra vez al navegar", async () => {
  const { rerender } = render(conPanel(<Sidebar />));
  await act(async () => {});
  expect(apiGet).toHaveBeenCalledTimes(1);
  datosMenu.ruta = "/agenda";
  rerender(conPanel(<Sidebar />));
  await act(async () => {});
  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(apiGet).toHaveBeenLastCalledWith("/api/deudores");
});

it("el menú lateral enlaza Tu consultorio a configuración", async () => {
  render(conPanel(<Sidebar />));
  expect((await screen.findByRole("link", { name: "Tu consultorio" })).getAttribute("href")).toBe("/config");
});

it('hace legibles los destinos inactivos sin cambiar los enlaces ni la altura de línea',()=>{
 datosMenu.ruta = "/cobros";
 render(conPanel(<BottomNav/>));
 const agenda=screen.getByRole('link',{name:'Agenda'});
 expect(agenda.classList.contains('text-ink-500')).toBe(true);
 expect(agenda.classList.contains('text-[12px]')).toBe(true);
 expect(agenda.classList.contains('leading-[15px]')).toBe(true);
 expect(agenda.getAttribute('href')).toBe('/agenda');
 expect(screen.getByRole('button',{name:'Lupita'}).classList.contains('text-ink-500')).toBe(true);
});

it('aclara que el número del menú cuenta deudas de más de treinta días', async()=>{
 datosMenu.deudores=[{diasAtraso:45},{diasAtraso:90},{diasAtraso:2}];
 render(conPanel(<Sidebar/>));
 const contador=await screen.findByLabelText('2 deudores con más de 30 días');
 expect(contador.textContent).toBe('2 · +30 días');
 expect(contador.title).toBe('2 pacientes con deudas de más de 30 días');
 expect(contador.closest('a')?.getAttribute('href')).toBe('/cobros');
});

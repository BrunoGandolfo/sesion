// @vitest-environment jsdom
//
// La pestaña Lux dentro de la ficha de verdad: existe, con el sol al lado
// del rótulo; al entrar saluda con el nombre de la profesional y sale la
// apertura; al cambiar de paciente no queda nada; y si ella dejó texto sin
// mandar, cambiar de pestaña pregunta antes. Las otras pestañas van dobladas.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { DATOS, IR_IGUAL, LUX, LUX_CONVERSACION, LUX_PLACEHOLDER, luxSaludo, QUEDARME, SALIDA_TRABAJO_TITULO } from "@/lib/glosario";

import { PacienteDetailView } from "../paciente-detail-view";

const m = vi.hoisted(() => ({ config: null as null | { nombreProfesional: string } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pacientes/p1",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: async (url: string) => {
    if (url === "/api/config") return m.config;
    const paciente = /^\/api\/pacientes\/(p\d)$/.exec(url)?.[1];
    if (!paciente) return null;
    return {
      paciente: { id: paciente, nombre: paciente === "p1" ? "Ana" : "Beto", apellido: "Sintética", telefono: "099000000", tarifa: 2200,
        notas: null, activo: true, creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", ultimaSesion: null, deudaTotal: 0 },
      turnos: [],
    };
  },
}));
vi.mock("@/hooks/useGrabacionSesion", () => ({ useGrabacionSesion: () => ({ sesionClinica: null, loading: false }) }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../sesiones-tab", () => ({ SesionesTab: () => <div data-testid="pestana-sesiones" /> }));
vi.mock("../recorrido-tab", () => ({ RecorridoTab: () => <div data-testid="pestana-recorrido" /> }));
vi.mock("../ficha-tab", () => ({ FichaTab: () => <div data-testid="pestana-datos" /> }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  m.config = { nombreProfesional: "Lic. Mariana López" };
  window.history.replaceState(null, "", "/pacientes/p1");
  fetchMock = vi.fn(async (url: string) => new Response(url.includes("p2") ? "Beto arrancó hace poco." : "Ana viene durmiendo mejor.", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ficha = (id: string) => (
  <ProteccionTrabajo>
    <PacienteDetailView id={id} />
  </ProteccionTrabajo>
);

async function entrarALux() {
  const pestana = await screen.findByRole("tab", { name: LUX });
  await act(async () => {
    fireEvent.click(pestana);
    await new Promise((r) => setTimeout(r, 0));
  });
}

it("la pestaña Lux existe, con el sol al lado, y nada sale hasta entrar", async () => {
  render(ficha("p1"));
  const pestana = await screen.findByRole("tab", { name: LUX });
  expect(pestana.querySelector('svg[data-personaje="lux"][aria-hidden="true"]')).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("al entrar saluda con el nombre de pila de la profesional y abre sola", async () => {
  render(ficha("p1"));
  await entrarALux();

  expect(screen.getByText(luxSaludo("Mariana", "Ana"))).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/pacientes/p1/lux");
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({});
  expect(screen.getByRole("log", { name: LUX_CONVERSACION }).textContent).toContain("Ana viene durmiendo mejor.");
  expect(window.location.search).toBe("?tab=lux");
});

it("sin configuración cargada saluda con 'Hola'", async () => {
  m.config = null;
  render(ficha("p1"));
  await entrarALux();
  expect(screen.getByText(luxSaludo("", "Ana"))).toBeTruthy();
});

it("al cambiar de paciente el chat se vacía y abre de nuevo para la otra", async () => {
  const { rerender } = render(ficha("p1"));
  await entrarALux();
  fireEvent.change(screen.getByPlaceholderText(LUX_PLACEHOLDER), { target: { value: "algo de Ana" } });

  await act(async () => {
    rerender(ficha("p2"));
    await new Promise((r) => setTimeout(r, 0));
  });
  await screen.findByText(luxSaludo("Mariana", "Beto"));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  const hilo = screen.getByRole("log", { name: LUX_CONVERSACION });
  expect(hilo.textContent).not.toContain("Ana");
  expect(hilo.textContent).toContain("Beto arrancó hace poco.");
  expect((screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement).value).toBe("");
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/pacientes/p2/lux");
});

it("con texto sin mandar, cambiar de pestaña pregunta; 'Ir igual' sale y 'Quedarme' no", async () => {
  render(ficha("p1"));
  await entrarALux();
  fireEvent.change(screen.getByPlaceholderText(LUX_PLACEHOLDER), { target: { value: "a medio escribir" } });

  fireEvent.click(screen.getByRole("tab", { name: DATOS }));
  expect(screen.getByText(SALIDA_TRABAJO_TITULO)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: QUEDARME }));
  expect(screen.queryByTestId("pestana-datos")).toBeNull();
  expect((screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement).value).toBe("a medio escribir");

  fireEvent.click(screen.getByRole("tab", { name: DATOS }));
  fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
  expect(screen.getByTestId("pestana-datos")).toBeTruthy();
});

it("sin texto pendiente, cambiar de pestaña no pregunta", async () => {
  render(ficha("p1"));
  await entrarALux();
  fireEvent.click(screen.getByRole("tab", { name: DATOS }));
  expect(screen.queryByText(SALIDA_TRABAJO_TITULO)).toBeNull();
  expect(screen.getByTestId("pestana-datos")).toBeTruthy();
});

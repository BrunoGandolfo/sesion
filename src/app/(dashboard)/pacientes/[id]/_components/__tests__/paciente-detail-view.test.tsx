// @vitest-environment jsdom
//
// Lo que la ficha lee y escribe en su URL: la pestaña (para que volver de una
// nota caiga en la misma), ?vuelve (la sesión que se abrió) y ?preparar=1, el
// contrato con Hoy y Agenda. Las pestañas van dobladas: tienen sus pruebas.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DATOS, RECORRIDO, SESIONES } from "@/lib/glosario";

import { PacienteDetailView } from "../paciente-detail-view";

const m = vi.hoisted(() => ({ consulta: "", sesionesProps: null as null | Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pacientes/p1",
  useSearchParams: () => new URLSearchParams(m.consulta),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: async (url: string) => {
    if (url === "/api/pacientes/p1") {
      return {
        paciente: { id: "p1", nombre: "Paciente", apellido: "Sintética", telefono: "099000000", tarifa: 2200, notas: null, activo: true,
          creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", ultimaSesion: null, deudaTotal: 0 },
        turnos: [],
      };
    }
    return null;
  },
}));
vi.mock("@/hooks/useGrabacionSesion", () => ({ useGrabacionSesion: () => ({ sesionClinica: null, loading: false }) }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../sesiones-tab", () => ({
  SesionesTab: (props: Record<string, unknown>) => {
    m.sesionesProps = props;
    return (
      <div data-testid="pestana-sesiones">
        <button onClick={() => (props.onAbrirSesion as (id: string) => void)("s9")}>abrir s9</button>
        <button onClick={() => (props.onVolvio as () => void)()}>volvió</button>
      </div>
    );
  },
}));
vi.mock("../recorrido-tab", () => ({ RecorridoTab: () => <div data-testid="pestana-recorrido" /> }));
vi.mock("../ficha-tab", () => ({ FichaTab: () => <div data-testid="pestana-datos" /> }));

function abrirFicha(consulta = "") {
  m.consulta = consulta;
  window.history.replaceState(null, "", `/pacientes/p1${consulta ? `?${consulta}` : ""}`);
  return render(<PacienteDetailView id="p1" />);
}

beforeEach(() => { m.sesionesProps = null; });
afterEach(cleanup);

it("la tercera pestaña se llama Datos, no Ficha", async () => {
  abrirFicha();
  const pestanas = (await screen.findAllByRole("tab")).map((t) => t.textContent);
  expect(pestanas).toEqual([SESIONES, RECORRIDO, DATOS]);
  expect(DATOS).toBe("Datos");
});

it("cambiar de pestaña lo escribe en la URL sin navegar, y la URL decide con cuál se abre", async () => {
  const { unmount } = abrirFicha("rango=6m");
  fireEvent.click(await screen.findByRole("tab", { name: DATOS }));
  expect(screen.getByTestId("pestana-datos")).toBeTruthy();
  // Conserva lo que otras partes de la ficha guardan en la URL.
  expect(window.location.search).toBe("?rango=6m&tab=datos");
  fireEvent.click(screen.getByRole("tab", { name: SESIONES }));
  expect(window.location.search).toBe("?rango=6m");
  unmount();

  // Volver de una nota trae la URL que se dejó: la pestaña es la misma.
  abrirFicha("tab=recorrido");
  expect(await screen.findByTestId("pestana-recorrido")).toBeTruthy();
  expect(screen.getByRole("tab", { name: RECORRIDO }).getAttribute("aria-selected")).toBe("true");
});

it("una pestaña desconocida en la URL abre Sesiones", async () => {
  abrirFicha("tab=ficha");
  expect(await screen.findByTestId("pestana-sesiones")).toBeTruthy();
});

it("?preparar=1 abre Sesiones con 'Preparar sesión' abierto, diga lo que diga ?tab", async () => {
  abrirFicha("tab=datos&preparar=1");
  expect(await screen.findByTestId("pestana-sesiones")).toBeTruthy();
  expect(m.sesionesProps?.prepararAbierto).toBe(true);
});

it("sin ?preparar, 'Preparar sesión' no se abre solo", async () => {
  abrirFicha();
  await screen.findByTestId("pestana-sesiones");
  expect(m.sesionesProps?.prepararAbierto).toBe(false);
});

it("al abrir una sesión anota cuál en la entrada que se deja; al volver se la pasa a la lista y la borra", async () => {
  const { unmount } = abrirFicha();
  fireEvent.click(await screen.findByRole("button", { name: "abrir s9" }));
  expect(window.location.search).toBe("?vuelve=s9");
  unmount();

  abrirFicha("vuelve=s9");
  await screen.findByTestId("pestana-sesiones");
  expect(m.sesionesProps?.volverA).toBe("s9");
  fireEvent.click(screen.getByRole("button", { name: "volvió" }));
  expect(window.location.search).toBe("");
});

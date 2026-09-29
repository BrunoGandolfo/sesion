// @vitest-environment jsdom
//
// Forense 03, P3-20. Ella escribe una nota privada, toca "Firmar
// autorización" y le pasa el teléfono a la paciente. A los 1,5 s el
// autoguardado de la nota recarga la ficha: antes el Badge llevaba como
// `key` el contador de recargas, se desmontaba y el sheet de firma se
// cerraba con lo que la paciente llevaba hecho. Ahora el Badge relee sin
// desmontarse, y /consentimiento se pide una vez por recarga, no tres.
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { AUTORIZACION_NO_VERIFICADA, FIRMAR_AUTORIZACION } from "@/lib/glosario";

import { PacienteDetailView } from "../paciente-detail-view";

const m = vi.hoisted(() => ({ pedidos: [] as string[], patch: vi.fn(), consentimientoFalla: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pacientes/p1",
  useSearchParams: () => new URLSearchParams("tab=datos"),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: async (url: string) => {
    m.pedidos.push(url);
    if (url === "/api/pacientes/p1") {
      return {
        paciente: { id: "p1", nombre: "Paciente", apellido: "Sintética", telefono: "+59899000000", tarifa: 2200, notas: null, activo: true,
          creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", ultimaSesion: null, deudaTotal: 0 },
        turnos: [],
      };
    }
    if (url === "/api/pacientes/p1/consentimiento") {
      if (m.consentimientoFalla) throw new Error("red");
      return { consentimiento: null };
    }
    if (url === "/api/config") return { nombreProfesional: "Lic. Prueba", direccion: "Calle 1" };
    return null;
  },
  apiPatch: (...args: unknown[]) => m.patch(...args),
}));
vi.mock("@/hooks/useGrabacionSesion", () => ({ useGrabacionSesion: () => ({ sesionClinica: null, loading: false }) }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../sesiones-tab", () => ({ SesionesTab: () => null }));
vi.mock("../recorrido-tab", () => ({ RecorridoTab: () => null }));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("@/components/ui")>()),
  Sheet: ({ open, children, ariaLabel }: { open: boolean; children: React.ReactNode; ariaLabel: string }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
beforeEach(() => {
  m.pedidos = [];
  m.consentimientoFalla = false;
  m.patch.mockReset();
  m.patch.mockResolvedValue({});
  window.history.replaceState(null, "", "/pacientes/p1?tab=datos");
});
afterEach(cleanup);

const lecturasDeConsentimiento = () => m.pedidos.filter((u) => u === "/api/pacientes/p1/consentimiento").length;

it("autoguardar una nota privada con el sheet de firma abierto no lo cierra ni pierde lo marcado", async () => {
  render(<PacienteDetailView id="p1" />);

  // Dos Badges (cabecera y Datos), UNA lectura de la autorización.
  const firmar = await screen.findAllByRole("button", { name: FIRMAR_AUTORIZACION });
  expect(firmar).toHaveLength(2);
  expect(lecturasDeConsentimiento()).toBe(1);

  // Abre la firma desde la pestaña Datos y la paciente marca que acepta.
  fireEvent.click(firmar[1]);
  const sheet = screen.getByRole("dialog", { name: "Firmar autorización de grabación" });
  const acepto = within(sheet).getByRole("checkbox") as HTMLInputElement;
  fireEvent.click(acepto);
  expect(acepto.checked).toBe(true);

  // Mientras tanto se guarda la nota privada: la ficha se recarga.
  fireEvent.change(screen.getByLabelText("Notas privadas del paciente"), { target: { value: "algo" } });
  await waitFor(() => expect(m.patch).toHaveBeenCalledWith("/api/pacientes/p1", { notas: "algo" }), { timeout: 3000 });
  await waitFor(() => expect(lecturasDeConsentimiento()).toBe(2));
  await act(async () => {});

  // El sheet sigue abierto, es el mismo, y lo marcado sigue marcado.
  const despues = screen.getByRole("dialog", { name: "Firmar autorización de grabación" });
  expect(despues).toBe(sheet);
  expect((within(despues).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  // Una lectura por recarga, no tres.
  expect(lecturasDeConsentimiento()).toBe(2);
});

it("si falla la lectura de la autorización, la ficha lo dice arriba y en Datos (P3-22)", async () => {
  m.consentimientoFalla = true;
  render(<PacienteDetailView id="p1" />);
  // Antes quedaba null y el aviso "falta autorización" no aparecía nunca.
  await waitFor(() => expect(screen.getAllByText(AUTORIZACION_NO_VERIFICADA)).toHaveLength(2));
  expect(screen.queryByRole("button", { name: FIRMAR_AUTORIZACION })).toBeNull();
});

// @vitest-environment jsdom
//
// El ConsentimientoBadge de verdad, sin mockear a null (forense 03, P3-27):
// qué dice en cada estado de la autorización, en sus dos variantes.
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTORIZACION_NO_VERIFICADA,
  CONVIENE_VOLVER_A_FIRMAR,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  FIRMAR_TEXTO_VIGENTE,
  REINTENTAR,
} from "@/lib/glosario";

import { ConsentimientoBadge, type EstadoConsentimiento } from "../ConsentimientoBadge";

const m = vi.hoisted(() => ({ borrar: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiDelete: (...a: unknown[]) => m.borrar(...a),
  apiPost: (...a: unknown[]) => m.post(...a),
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("@/components/ui")>()),
  Sheet: ({ open, children, ariaLabel }: { open: boolean; children: React.ReactNode; ariaLabel: string }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
beforeEach(() => { m.borrar.mockReset(); m.post.mockReset(); });
afterEach(cleanup);

const VIGENTE = (sugiereRefirmar = false): EstadoConsentimiento => ({
  tipo: "vigente",
  consentimiento: { id: "c1", pacienteId: "p1", firmadoEn: "2026-09-05T15:00:00.000Z", textoVersion: sugiereRefirmar ? "2.7" : "2.8", vigente: true, sugiereRefirmar },
});

function montar(estado: EstadoConsentimiento, variante: "completo" | "aviso" = "completo", onCambio = vi.fn()) {
  render(
    <ConsentimientoBadge
      variante={variante}
      pacienteId="p1"
      nombrePaciente="María González"
      nombreProfesional="Lic. Ana Pérez"
      direccionConsultorio="Av. 18 de Julio 1234"
      estado={estado}
      onCambio={onCambio}
    />,
  );
  return onCambio;
}

describe("variante completo (pestaña Datos)", () => {
  it("mientras la ficha lee, muestra que está verificando", () => {
    montar({ tipo: "cargando" });
    expect(screen.getByRole("status", { name: "Verificando autorización" })).toBeTruthy();
  });

  it("vigente: 'Grabación autorizada' y la fecha; sin aviso de volver a firmar", () => {
    montar(VIGENTE());
    expect(screen.getByText("Grabación autorizada")).toBeTruthy();
    expect(screen.getByText(/Firmada el 5 de septiembre de 2026/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(CONVIENE_VOLVER_A_FIRMAR))).toBeNull();
  });

  it("con sugiereRefirmar avisa que conviene volver a firmar y abre el texto vigente (P3-28)", () => {
    montar(VIGENTE(true));
    expect(screen.getByText("Grabación autorizada")).toBeTruthy();
    expect(screen.getByText(new RegExp(CONVIENE_VOLVER_A_FIRMAR))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: FIRMAR_TEXTO_VIGENTE }));
    expect(screen.getByRole("dialog", { name: "Firmar autorización de grabación" })).toBeTruthy();
  });

  it("sin autorización: 'Falta la autorización' y Firmar abre el sheet", () => {
    montar({ tipo: "sin" });
    expect(screen.getByText(FALTA_AUTORIZACION)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: FIRMAR_AUTORIZACION }));
    expect(screen.getByRole("dialog", { name: "Firmar autorización de grabación" })).toBeTruthy();
  });

  it("si la lectura falló lo dice y Reintentar le pide a la ficha que relea (P3-22)", () => {
    const onCambio = montar({ tipo: "error" });
    expect(screen.getByRole("alert").textContent).toBe(AUTORIZACION_NO_VERIFICADA);
    fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
    expect(onCambio).toHaveBeenCalledOnce();
  });

  it("revocar pide confirmación, hace DELETE y avisa a la ficha", async () => {
    m.borrar.mockResolvedValue(null);
    const onCambio = montar(VIGENTE());
    fireEvent.click(screen.getByRole("button", { name: "Revocar" }));
    expect(screen.getByText("¿Revocar la autorización de grabación?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Revocar" }).at(-1)!);
    await waitFor(() => expect(onCambio).toHaveBeenCalledOnce());
    expect(m.borrar).toHaveBeenCalledWith("/api/pacientes/p1/consentimiento");
  });

  it("si revocar falla, lo dice y no avisa a la ficha", async () => {
    m.borrar.mockRejectedValue(new Error("red"));
    const onCambio = montar(VIGENTE());
    fireEvent.click(screen.getByRole("button", { name: "Revocar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Revocar" }).at(-1)!);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onCambio).not.toHaveBeenCalled();
  });
});

describe("variante aviso (cabecera de la ficha)", () => {
  it("vigente y al día: no dibuja nada", () => {
    montar(VIGENTE(), "aviso");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("mientras la ficha lee no dice nada todavía", () => {
    montar({ tipo: "cargando" }, "aviso");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sin autorización: el aviso y el botón de firmar", () => {
    montar({ tipo: "sin" }, "aviso");
    expect(screen.getByRole("status").textContent).toContain(FALTA_AUTORIZACION);
    expect(screen.getByRole("button", { name: FIRMAR_AUTORIZACION })).toBeTruthy();
  });

  it("firma de un texto anterior: el aviso de volver a firmar (P3-28)", () => {
    montar(VIGENTE(true), "aviso");
    expect(screen.getByRole("status").textContent).toContain(CONVIENE_VOLVER_A_FIRMAR);
    fireEvent.click(screen.getByRole("button", { name: FIRMAR_TEXTO_VIGENTE }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("si la lectura falló, la cabecera lo dice en vez de callarse (P3-22)", () => {
    const onCambio = montar({ tipo: "error" }, "aviso");
    expect(screen.getByRole("status").textContent).toContain(AUTORIZACION_NO_VERIFICADA);
    fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
    expect(onCambio).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
//
// La pestaña Recorrido entera: qué se lee primero, con qué nombres, y cuándo
// se enciende la alerta de la última sesión.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { apiGet } from "@/lib/api-client";
import {
  INDICADORES_POR_SESION,
  INDICADORES_SON_ESTIMACIONES,
  POCO_RECORRIDO_TITULO,
  ULTIMA_SESION_CON_SENAL,
} from "@/lib/glosario";
import { hiloVacio, type Recorrido, type VersionHilo } from "@/lib/hilo/contenido";

import type { ProgresoResponse, SesionProgreso } from "../graficos/base";
import { RecorridoTab } from "../recorrido-tab";

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/pacientes/p1",
  useSearchParams: () => new URLSearchParams(),
}));

const version = (n: number): VersionHilo => ({
  id: `version-${n}`, version: n, basadaEnVersion: n - 1 || null, actor: "profesional", estado: "aplicada",
  sesionOrigenId: null, creadaPorUserId: "u", creadaEn: "2026-09-01T15:00:00Z", resueltaEn: null,
  resueltaPorUserId: null, propuestaOrigenId: null,
  contenido: {
    ...hiloVacio(),
    hipotesisDiagnostica: "Ansiedad con evitación",
    resumenAcumulativo: "Primera sesión: llegó derivada.",
    objetivosTerapeuticos: [{ id: "o1", descripcion: "Dormir sin medicación", estado: "activo", fechaInicio: "2026-08-01", fechaCierre: null }],
  },
});

const hilo = (): Recorrido => ({
  pacienteId: "p1",
  vigente: version(1),
  propuesta: { ...version(2), actor: "ia", estado: "propuesta", contenido: { ...version(2).contenido, cambios: ["Agrega la tercera sesión"] } },
  desactualizadas: [], trabajos: [], sesionesAprobadas: [], totalSesionesAprobadas: 3,
  historial: [version(1)],
  hayMas: false,
});

const SIN_FLAGS = { ideacionSuicida: false, autolesion: false, violenciaTerceros: false, sintomasPsicoticos: false, crisisPanico: false };

function sesion(n: number, extra: Partial<SesionProgreso> = {}): SesionProgreso {
  return {
    sesionId: `s${n}`, fecha: `2026-09-0${n}T14:00:00.000Z`, numero: n, intensidadEmocional: 5,
    alianzaTerapeutica: "estable", temas: ["Trabajo"], nivelRiesgo: "ninguno", flagsRiesgo: SIN_FLAGS,
    intervenciones: { validacion: 1 }, observacionIA: null,
    progresoPercibido: "Sin riesgo a la vista; superó la crisis del mes pasado.", ...extra,
  };
}

function progreso(sesiones: SesionProgreso[]): ProgresoResponse {
  return { pacienteId: "p1", totalSesiones: sesiones.length, rango: "10s", sesiones, temas: [], riesgos: [] };
}

function servir(datosProgreso: ProgresoResponse) {
  vi.mocked(apiGet).mockImplementation(async (url: string) =>
    (url.includes("/progreso") ? datosProgreso : hilo()) as never,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

const pestana = () => render(<ProteccionTrabajo><RecorridoTab pacienteId="p1" /></ProteccionTrabajo>);

/** ¿`a` está antes que `b` en el documento? */
const antes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("el orden del Recorrido", () => {
  it("objetivos e hipótesis primero; después la propuesta, los indicadores y, al final, el historial", async () => {
    servir(progreso([sesion(1), sesion(2), sesion(3)]));
    const { container } = pestana();

    const objetivos = await screen.findByRole("heading", { name: "Objetivos" });
    const hipotesis = screen.getByRole("heading", { name: "Hipótesis clínica" });
    const relato = container.querySelector("details")!;
    const propuesta = screen.getByRole("heading", { name: "Hay una propuesta nueva" });
    const indicadores = await screen.findByText(INDICADORES_POR_SESION);
    const historial = screen.getByText(/^Historial de versiones/);

    expect(relato.textContent).toContain("El recorrido hasta hoy");
    expect(relato.open).toBe(false);
    for (const [a, b] of [[objetivos, hipotesis], [hipotesis, relato], [relato, propuesta], [propuesta, indicadores], [indicadores, historial]] as const) {
      expect(antes(a, b)).toBe(true);
    }
  });

  it("un solo nombre a la vista: ni «El hilo» ni «Cómo va»", async () => {
    servir(progreso([sesion(1), sesion(2), sesion(3)]));
    const { container } = pestana();
    await screen.findByRole("heading", { name: "Objetivos" });
    await screen.findByText(INDICADORES_SON_ESTIMACIONES);

    expect(screen.getByRole("region", { name: "Recorrido" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/el hilo|cómo va/i);
  });

  it("los indicadores dicen que son estimaciones aunque todavía no haya tres sesiones", async () => {
    servir(progreso([sesion(1), sesion(2)]));
    pestana();
    expect(await screen.findByText(INDICADORES_SON_ESTIMACIONES)).toBeTruthy();
    // El estado vacío que explica las tres sesiones se conserva (plegado, como antes).
    screen.getByRole("button", { name: new RegExp(INDICADORES_POR_SESION) }).click();
    expect(await screen.findByText(POCO_RECORRIDO_TITULO)).toBeTruthy();
  });
});

describe("la alerta de la última sesión la decide el servidor", () => {
  it("una nota que dice «sin riesgo» y «crisis» no la enciende si el servidor no marcó señal", async () => {
    servir(progreso([sesion(1), sesion(2), sesion(3)]));
    pestana();
    await screen.findByText(/Sin riesgo a la vista/);
    expect(screen.queryByText(ULTIMA_SESION_CON_SENAL)).toBeNull();
  });

  it.each([
    ["el nivel graduado", { nivelRiesgo: "moderado" as const }],
    ["un flag activo", { flagsRiesgo: { ...SIN_FLAGS, autolesion: true } }],
  ])("la enciende %s, diga lo que diga el texto", async (_caso, extra) => {
    servir(progreso([sesion(1), sesion(2), sesion(3, { ...extra, progresoPercibido: "Se la ve tranquila." })]));
    pestana();
    await screen.findByText(/Se la ve tranquila/);
    expect(screen.getByText(ULTIMA_SESION_CON_SENAL)).toBeTruthy();
  });
});

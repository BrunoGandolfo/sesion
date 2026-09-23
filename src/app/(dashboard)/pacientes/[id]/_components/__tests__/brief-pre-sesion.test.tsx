// @vitest-environment jsdom
//
// "Preparar sesión": el resumen previo, plegado. Cerrado por defecto; abierto
// y a la vista cuando la ficha se pide con ?preparar=1 (contrato con Hoy y
// Agenda). La señal de riesgo no se pliega. Nada se recorta.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EL_HILO, EL_RECORRIDO_HASTA_HOY, PREPARAR_SESION, SENAL_DE_RIESGO } from "@/lib/glosario";

import { BriefPreSesion } from "../brief-pre-sesion";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

const RESUMEN = "Una oración del resumen de la última sesión. ".repeat(12) + "Fin del resumen.";
const RECORRIDO = "Una oración del recorrido del proceso. ".repeat(12) + "Fin del recorrido.";
const OBJETIVOS = ["Primer objetivo", "Segundo objetivo", "Tercer objetivo", "Cuarto objetivo", "Quinto objetivo"];

function brief(riesgo: boolean) {
  return {
    pacienteId: "p1", propuestaPendiente: false, notaPendiente: false,
    proximoTurno: { fecha: "2026-09-27T13:00:00.000Z", duracion: 50, modalidad: "presencial" },
    ultimaSesion: {
      fecha: "2026-09-17T13:00:00.000Z", pendienteAprobacion: false, resumenSesion: RESUMEN,
      focoProximaSesion: "Retomar lo pendiente.", progresoPercibido: "Mejor que hace un mes.", temas: [],
      riesgo: riesgo
        ? { flagsActivos: ["ideacionSuicida"], nivel: "moderado", indicadores: [], notaParaTerapeuta: "Preguntar directamente." }
        : { flagsActivos: [], nivel: "ninguno", indicadores: [], notaParaTerapeuta: null },
    },
    hiloLongitudinal: {
      resumenAcumulativo: RECORRIDO, hipotesisDiagnostica: null, temasRecurrentes: [{ tema: "familia", conteo: 5 }],
      objetivosActivos: OBJETIVOS, riesgosHistoricos: [], revisadoPorTerapeuta: true,
    },
  };
}

beforeEach(() => { m.get.mockReset(); });
afterEach(cleanup);

it("arranca cerrado, se llama 'Preparar sesión' y al abrirlo está todo, entero", async () => {
  m.get.mockResolvedValue(brief(false));
  render(<BriefPreSesion pacienteId="p1" />);
  const boton = await screen.findByRole("button", { name: PREPARAR_SESION });
  expect(boton.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(RESUMEN.trim())).toBeNull();

  fireEvent.click(boton);
  expect(boton.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(boton.getAttribute("aria-controls")!)!;
  // Ni tres líneas ni tres objetivos: lo que hay.
  expect(panel.querySelector("[class*='line-clamp'], .truncate")).toBeNull();
  expect(screen.getByText(RESUMEN.trim())).toBeTruthy();
  expect(screen.getByText(RECORRIDO.trim())).toBeTruthy();
  for (const objetivo of OBJETIVOS) expect(screen.getByText(`· ${objetivo}`)).toBeTruthy();
  expect(screen.getByText("Retomar lo pendiente.")).toBeTruthy();
  expect(screen.getByText(/Próxima:/)).toBeTruthy();

  // Los nombres viejos no están en este bloque.
  expect(screen.queryByText(EL_HILO, { exact: false })).toBeNull();
  expect(screen.getByText(EL_RECORRIDO_HASTA_HOY)).toBeTruthy();
});

it("con abrir (?preparar=1) está abierto y se trae a la vista al cargar, una sola vez", async () => {
  const traer = vi.fn();
  Element.prototype.scrollIntoView = traer;
  m.get.mockResolvedValue(brief(false));
  const { rerender } = render(<BriefPreSesion pacienteId="p1" abrir />);
  const boton = await screen.findByRole("button", { name: PREPARAR_SESION });
  expect(boton.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(RESUMEN.trim())).toBeTruthy();
  await waitFor(() => expect(traer).toHaveBeenCalledOnce());
  expect(traer.mock.instances[0]).toBe(document.getElementById(boton.getAttribute("aria-controls")!));

  rerender(<BriefPreSesion pacienteId="p1" abrir />);
  expect(traer).toHaveBeenCalledOnce();
  // Y se puede cerrar.
  fireEvent.click(boton);
  expect(screen.queryByText(RESUMEN.trim())).toBeNull();
});

it("la señal de riesgo no se pliega: se dice al lado del botón aunque esté cerrado", async () => {
  m.get.mockResolvedValue(brief(true));
  render(<BriefPreSesion pacienteId="p1" />);
  const boton = await screen.findByRole("button", { name: PREPARAR_SESION });
  expect(boton.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText(SENAL_DE_RIESGO)).toBeTruthy();
  // Abierto, el detalle completo, como alerta.
  fireEvent.click(boton);
  expect(screen.getByRole("alert").textContent).toContain("Preguntar directamente.");
});

it("sin señal de riesgo no dice nada de riesgo", async () => {
  m.get.mockResolvedValue(brief(false));
  render(<BriefPreSesion pacienteId="p1" />);
  await screen.findByRole("button", { name: PREPARAR_SESION });
  expect(screen.queryByText(SENAL_DE_RIESGO)).toBeNull();
});

// @vitest-environment jsdom
// Con la respuesta de ejemplo del contrato, lo que se ve son los números del
// JSON, y los `null` se dicen con palabras.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";
import { NOTA_FINANZAS, SIN_DATOS_PARA_COMPARAR } from "@/lib/glosario";

import { FinanzasView } from "../finanzas-view";
import { RESPUESTA_EJEMPLO } from "./respuesta-ejemplo";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet,
}));

beforeEach(() => {
  apiGet.mockReset();
});

async function mostrar(respuesta: ResumenFinanzas) {
  apiGet.mockResolvedValue(respuesta);
  const vista = render(<FinanzasView />);
  await screen.findByRole("tablist");
  return vista;
}

function bloque(titulo: string): HTMLElement {
  return screen.getByRole("heading", { level: 2, name: titulo }).closest("section")!;
}

it("lo que entró: el cobrado del período y las dos comparaciones del servidor", async () => {
  await mostrar(RESPUESTA_EJEMPLO);
  const entro = within(bloque("Lo que entró"));
  expect(entro.getByText("$ 5.100")).toBeTruthy();
  expect(entro.getByText("4 sesiones cobradas")).toBeTruthy();
  expect(entro.getByText("ago–sep 2026")).toBeTruthy();

  const anterior = entro.getByText("Contra el período anterior").closest("div")!;
  expect(anterior.textContent).toContain("jun–jul 2026: $ 1.200");
  expect(anterior.textContent).toContain("+ $ 3.900");
  expect(anterior.textContent).toContain("+325 %");

  const anioPasado = entro.getByText("Contra el mismo período del año pasado").closest("div")!;
  expect(anioPasado.textContent).toContain("ago–sep 2025: $ 1.000");
  expect(anioPasado.textContent).toContain("+ $ 4.100");
  expect(anioPasado.textContent).toContain("+410 %");
});

it("una comparación null dice 'sin datos para comparar', nunca un cero", async () => {
  await mostrar({
    ...RESPUESTA_EJEMPLO,
    comparaciones: { periodoAnterior: null, mismoPeriodoAnioAnterior: null },
  });
  const entro = bloque("Lo que entró");
  expect(within(entro).getAllByText(SIN_DATOS_PARA_COMPARAR)).toHaveLength(2);
  expect(entro.textContent).not.toMatch(/\$ 0|0 %/);
});

it("con la base en cero el porcentaje no aparece: sólo los pesos", async () => {
  const anterior = RESPUESTA_EJEMPLO.comparaciones.periodoAnterior!;
  await mostrar({
    ...RESPUESTA_EJEMPLO,
    comparaciones: {
      ...RESPUESTA_EJEMPLO.comparaciones,
      periodoAnterior: { ...anterior, cobrado: 0, variacionCobrado: 5100, porcentajeCobrado: null },
    },
  });
  const linea = within(bloque("Lo que entró")).getByText("Contra el período anterior").closest("div")!;
  expect(linea.textContent).toContain("+ $ 5.100");
  expect(linea.textContent).not.toContain("%");
});

it("lo que trabajaste: trabajado, sesiones, pacientes, tarifa, cada diez y lo aparte", async () => {
  await mostrar(RESPUESTA_EJEMPLO);
  const trabajo = bloque("Lo que trabajaste");
  expect(within(trabajo).getByText("$ 7.500")).toBeTruthy();
  expect(trabajo.textContent).toContain("Ya cobraste $ 5.100 de esto; faltan $ 2.400.");
  const cifras = Object.fromEntries(
    Array.from(trabajo.querySelectorAll("dl > div")).map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ]),
  );
  expect(cifras).toEqual({ "Sesiones realizadas": "6", Pacientes: "3", "Tarifa promedio": "$ 1.250" });
  expect(trabajo.textContent).toContain("De cada diez sesiones que diste, cobraste 7.");
  expect(trabajo.textContent).toContain(
    "Aparte: 1 turno con No vino ($ 1.200) y 1 cancelado. No suman a lo trabajado; una ausencia que cobraste sí está en lo que entró.",
  );
});

it("sin sesiones realizadas la tarifa es '—' y no hay frase de cada diez", async () => {
  await mostrar({
    ...RESPUESTA_EJEMPLO,
    totales: { ...RESPUESTA_EJEMPLO.totales, tarifaPromedio: null },
    proporcionCobrada: { deCadaDiez: null, porcentaje: null, sesionesRealizadas: 0, sesionesRealizadasCobradas: 0 },
  });
  const trabajo = bloque("Lo que trabajaste");
  expect(trabajo.textContent).toContain("Tarifa promedio—");
  expect(trabajo.textContent).toContain("No diste sesiones en este período.");
  expect(trabajo.textContent).not.toContain("De cada diez");
});

it("te deben hoy: el total y los tres tramos, con el enlace a Cobros", async () => {
  await mostrar(RESPUESTA_EJEMPLO);
  const deuda = bloque("Te deben hoy");
  expect(within(deuda).getAllByText("$ 2.400")).toHaveLength(2);
  const filas = Array.from(deuda.querySelectorAll("li")).map((li) => li.textContent);
  expect(filas).toEqual([
    "Hasta 30 días$ 2.4002 sesiones · 2 pacientes",
    "De 31 a 90 días$ 00 sesiones · 0 pacientes",
    "Más de 90 días$ 00 sesiones · 0 pacientes",
  ]);
  expect(within(deuda).getByRole("link", { name: "Ver a quiénes te deben, en Cobros" }).getAttribute("href")).toBe("/cobros");
});

it("cómo te pagan: los métodos en el orden del servidor, con sus montos", async () => {
  await mostrar(RESPUESTA_EJEMPLO);
  const filas = Array.from(bloque("Cómo te pagan").querySelectorAll("li")).map((li) => li.textContent);
  expect(filas).toEqual([
    "Efectivo2 sesiones$ 2.400",
    "MercadoPago1 sesión$ 1.500",
    "Transferencia1 sesión$ 1.200",
  ]);
});

it("la nota del pie dice que no hay ajuste por inflación ni gastos", async () => {
  await mostrar(RESPUESTA_EJEMPLO);
  expect(screen.getByText(NOTA_FINANZAS)).toBeTruthy();
});

it("con doce meses queda una sola comparación: las dos ventanas son la misma", async () => {
  const anioPasado = { ...RESPUESTA_EJEMPLO.comparaciones.mismoPeriodoAnioAnterior!, desde: "2024-10", hasta: "2025-09" };
  await mostrar({
    ...RESPUESTA_EJEMPLO,
    desde: "2025-10",
    hasta: "2026-09",
    comparaciones: { periodoAnterior: anioPasado, mismoPeriodoAnioAnterior: anioPasado },
  });
  const entro = within(bloque("Lo que entró"));
  expect(entro.queryByText("Contra el período anterior")).toBeNull();
  expect(entro.getByText("Contra el mismo período del año pasado")).toBeTruthy();
});

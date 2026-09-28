// @vitest-environment jsdom
//
// Matriz: para cada estado de la sesión, la fila (Hoy y Agenda), la card de
// Ahora y el detalle del turno ofrecen la MISMA acción clínica. Antes cada
// pantalla tenía su regla: con una subida en curso la card decía
// "Procesando" y la fila, abajo, ofrecía "Grabar sesión"; con una nota
// fallida la fila ofrecía grabar y el servidor contestaba 409 (forense 03,
// P3-08). Las tres llaman ahora a accionClinicaDe; esto mira lo que dibujan.
import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import type { TurnoConPaciente } from "@/types/domain";
import { UMBRAL_GRABANDO_SIN_TERMINAR_MS, UMBRAL_SIN_TERMINAR_MS } from "@/lib/sesion-clinica/estados";
import { accionClinicaDe } from "@/lib/sesion-clinica/accion-clinica";

import { SessionRow } from "../session-row";
import { CardAhora } from "@/app/(dashboard)/_components/card-ahora";
import { TurnoDetailSheet } from "@/app/(dashboard)/agenda/_components/turno-detail-sheet";

const api = vi.hoisted(() => ({ sesion: null as unknown }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: (ruta: string) =>
    Promise.resolve(ruta.startsWith("/api/sesion-clinica") ? api.sesion : ruta.includes("/brief") ? null : []),
  apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));
vi.mock("@/components/clinico/brief-corto", () => ({
  BriefCorto: () => null,
  BriefCortoDePaciente: () => null,
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("@/components/ui")>()),
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

// 15:00 en Montevideo; "ahora" son las 15:20 del mismo día.
const INICIO = new Date("2026-09-23T18:00:00.000Z");
const AHORA = new Date("2026-09-23T18:20:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterEach(cleanup);

function turno(sesion: TurnoConPaciente["sesionClinica"]): TurnoConPaciente {
  return {
    id: "t1", serieId: null, pacienteId: "p1", organizationId: "org",
    fecha: INICIO, duracion: 50, modalidad: "presencial", estado: "programado",
    tarifaCobrada: 2200, pagoEstado: "pagado", pagoFecha: AHORA, pagoMetodo: "efectivo",
    notas: null, creadoEn: INICIO, actualizadoEn: INICIO, sesionClinica: sesion,
    paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099123456" },
  };
}

type Ofrecida = "grabar" | "escribiendo" | "nota" | "ninguna";

/** Lo que la pantalla ofrece, leído del DOM: un camino a grabar, el aviso
 *  de que se está escribiendo, un enlace a la nota, o nada. */
function ofrecida(contenedor: HTMLElement): Ofrecida {
  const aGrabar =
    contenedor.querySelector('a[href="/grabar/t1"]') !== null ||
    [...contenedor.querySelectorAll("button")].some((b) => /Grabar sesión/i.test(b.textContent ?? ""));
  const aNota = contenedor.querySelector('a[href^="/sesiones/"]') !== null;
  const escribiendo = contenedor.querySelector('[role="status"]') !== null;
  const cuantas = [aGrabar, aNota, escribiendo].filter(Boolean).length;
  if (cuantas > 1) throw new Error(`la pantalla ofrece más de una acción clínica: ${contenedor.innerHTML}`);
  return aGrabar ? "grabar" : aNota ? "nota" : escribiendo ? "escribiendo" : "ninguna";
}

async function enLaFila(t: TurnoConPaciente): Promise<Ofrecida> {
  const { container } = render(<SessionRow turno={t} ahora={AHORA} onGrabar={() => {}} onClick={() => {}} />);
  return ofrecida(container);
}

async function enLaCard(t: TurnoConPaciente): Promise<Ofrecida> {
  api.sesion = t.sesionClinica;
  let contenedor!: HTMLElement;
  await act(async () => {
    contenedor = render(
      <CardAhora turno={t} ahora={AHORA} enCurso sinAutorizacion={false} sinCobrar={false} onCobrar={() => {}} />,
    ).container;
  });
  // "Preparar sesión" y la ficha no son la acción clínica.
  return ofrecida(contenedor);
}

async function enElDetalle(t: TurnoConPaciente): Promise<Ofrecida> {
  api.sesion = t.sesionClinica;
  let contenedor!: HTMLElement;
  await act(async () => {
    contenedor = render(<TurnoDetailSheet open turno={t} onClose={() => {}} onUpdated={() => {}} />).container;
  });
  return ofrecida(contenedor);
}

const CASOS: Array<[string, TurnoConPaciente["sesionClinica"]]> = [
  ["sin sesión", null],
  ["grabando reciente", { id: "s1", estado: "grabando", actualizadaEn: hace(60_000) }],
  ["grabando quieta", { id: "s1", estado: "grabando", actualizadaEn: hace(UMBRAL_GRABANDO_SIN_TERMINAR_MS + 60_000) }],
  ["subiendo reciente", { id: "s1", estado: "subiendo", actualizadaEn: hace(60_000) }],
  ["subiendo quieta", { id: "s1", estado: "subiendo", actualizadaEn: hace(UMBRAL_SIN_TERMINAR_MS + 60_000) }],
  ["procesando", { id: "s1", estado: "procesando", actualizadaEn: hace(60_000) }],
  ["revision", { id: "s1", estado: "revision", actualizadaEn: hace(60_000) }],
  ["aprobada", { id: "s1", estado: "aprobada", actualizadaEn: hace(60_000) }],
  ["fallida", { id: "s1", estado: "fallida", actualizadaEn: hace(60_000) }],
];

describe("fila = card = detalle", () => {
  it.each(CASOS)("%s", async (_nombre, sesion) => {
    const t = turno(sesion);
    const esperada = accionClinicaDe(sesion, t, AHORA).tipo;
    const fila = await enLaFila(t);
    cleanup();
    const card = await enLaCard(t);
    cleanup();
    const detalle = await enElDetalle(t);
    expect({ fila, card, detalle }).toEqual({ fila: esperada, card: esperada, detalle: esperada });
  });
});

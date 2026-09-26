// @vitest-environment jsdom
//
// Hoy y Lupita posada (docs/diseno/06-lupita-presencia.md). La regla dura
// (R1): un día con alguna señal de riesgo, Lupita no aparece en Hoy, tampoco
// la posada. Y como Hoy lee el día de forma asíncrona, mientras carga —o si
// la lectura falla— tampoco: no se sabe todavía.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  anotarRutaLupita,
  obtenerLupita,
  posadaVisible,
  reiniciarLupitaParaTests,
} from "@/lib/lupita-presencia";
import { Dashboard } from "../dashboard";
import { leerHoy, SIN_PENDIENTES, type EstadoHoy } from "../datos";

vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn().mockResolvedValue({}),
}));
vi.mock("../datos", async (original) => ({
  ...await original<typeof import("../datos")>(), leerHoy: vi.fn(),
}));
vi.mock("framer-motion", async (original) => ({
  ...await original<typeof import("framer-motion")>(), useReducedMotion: () => true,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null }));
vi.mock("../agenda-del-dia", () => ({ AgendaDelDia: () => <p>Agenda del día</p> }));

function dia(riesgoEnElDia: boolean): EstadoHoy {
  return {
    nombre: null,
    ahora: new Date("2026-09-10T14:00:00Z"),
    riesgoEnElDia,
    data: {
      inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: 0, deudaAcumulada: 0, ingresosMes: 0 },
      sesionesHoy: [],
      deudores: [],
      proximaSesion: null,
      riesgoDelDia: [],
      pendientes: SIN_PENDIENTES,
    },
  } as EstadoHoy;
}

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarLupitaParaTests();
  anotarRutaLupita("/");
});

describe("Hoy decide si la posada aparece", () => {
  it("un día sin riesgo, aparece cuando Hoy terminó de leer", async () => {
    let entregar!: (e: EstadoHoy) => void;
    vi.mocked(leerHoy).mockReturnValue(new Promise((r) => { entregar = r; }));
    render(<Dashboard />);
    // Cargando: no se sabe todavía.
    expect(posadaVisible(obtenerLupita())).toBe(false);
    await act(async () => entregar(dia(false)));
    await screen.findByText("Agenda del día");
    expect(posadaVisible(obtenerLupita())).toBe(true);
  });

  it("un día con riesgo, no aparece", async () => {
    vi.mocked(leerHoy).mockResolvedValue(dia(true));
    render(<Dashboard />);
    await screen.findByText("Agenda del día");
    expect(posadaVisible(obtenerLupita())).toBe(false);
  });

  it("si la lectura falla, no aparece", async () => {
    vi.mocked(leerHoy).mockRejectedValue(new Error("sin red"));
    render(<Dashboard />);
    await act(async () => {});
    expect(posadaVisible(obtenerLupita())).toBe(false);
  });

  it("al irse de Hoy, lo que dijo del día se olvida", async () => {
    vi.mocked(leerHoy).mockResolvedValue(dia(false));
    const { unmount } = render(<Dashboard />);
    await screen.findByText("Agenda del día");
    unmount();
    expect(obtenerLupita().riesgoDelDia).toBeNull();
  });
});

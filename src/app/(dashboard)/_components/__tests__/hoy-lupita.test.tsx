// @vitest-environment jsdom
//
// Hoy y Lupita posada (docs/diseno/06-lupita-presencia.md). La regla dura
// (R1): un día con alguna señal de riesgo, Lupita no aparece en Hoy, tampoco
// la posada. Y como Hoy lee el día de forma asíncrona, mientras carga —o si
// la lectura falla— tampoco: no se sabe todavía.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  anotarRutaLupita,
  obtenerLupita,
  posadaVisible,
  reiniciarLupitaParaTests,
} from "@/lib/lupita-presencia";
import { Dashboard } from "../dashboard";
import { olvidarSaludoParaTests, tocaElGestoDelSaludo, tocaSaludarHoy } from "../saludo";
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
vi.mock("../agenda-del-dia", () => ({
  AgendaDelDia: ({ onCobrar }: { onCobrar: (id: string) => void }) => (
    <>
      <p>Agenda del día</p>
      <button onClick={() => onCobrar("t1")}>Cobrar</button>
    </>
  ),
}));
// El sheet del método, como el de verdad: cobra y, cuando terminó, se cierra.
vi.mock("../sheet-metodo-pago", () => ({
  SheetMetodoPago: ({ open, onElegir, onClose }: {
    open: boolean; onElegir: (m: string) => Promise<void>; onClose: () => void;
  }) => (open ? <button onClick={async () => { await onElegir("efectivo"); onClose(); }}>Efectivo</button> : null),
}));

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
  // El día de `dia()` (2026-09-10 en Montevideo), como lo anota la posada.
  anotarRutaLupita("/", "2026-09-10");
  olvidarSaludoParaTests();
  window.localStorage.clear();
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

  // Corrección del dueño (27-sep-2026): al irse de Hoy la lectura NO se
  // borra, para que al volver el mismo día la posada no se vaya y vuelva.
  it("al irse de Hoy, lo que leyó del día queda anotado con su fecha", async () => {
    vi.mocked(leerHoy).mockResolvedValue(dia(false));
    const { unmount } = render(<Dashboard />);
    await screen.findByText("Agenda del día");
    unmount();
    expect(obtenerLupita().riesgoDelDia).toEqual({ dia: "2026-09-10", hay: false });
  });

  it("al volver el mismo día sin riesgo, la posada está desde el primer cuadro", async () => {
    anotarRutaLupita("/agenda", "2026-09-10");
    vi.mocked(leerHoy).mockResolvedValue(dia(false));
    const { unmount } = render(<Dashboard />);
    await screen.findByText("Agenda del día");
    unmount();
    anotarRutaLupita("/", "2026-09-10");
    let entregar!: (e: EstadoHoy) => void;
    vi.mocked(leerHoy).mockReturnValue(new Promise((r) => { entregar = r; }));
    render(<Dashboard />);
    // Todavía cargando: se queda igual.
    expect(posadaVisible(obtenerLupita())).toBe(true);
    // Si la lectura nueva trae riesgo, se retira.
    await act(async () => entregar(dia(true)));
    expect(posadaVisible(obtenerLupita())).toBe(false);
  });
});

describe("la línea del día", () => {
  it("la primera vez del día hay línea y la posada saluda; la segunda, nada", async () => {
    vi.mocked(leerHoy).mockResolvedValue(dia(false));
    const { unmount } = render(<Dashboard />);
    expect(await screen.findByText("Hoy no hay agenda. Buen momento para ponerte al día.")).toBeTruthy();
    expect(obtenerLupita().gesto?.tipo).toBe("saludo");
    unmount();

    reiniciarLupitaParaTests();
    anotarRutaLupita("/", "2026-09-10");
    render(<Dashboard />);
    await screen.findByText("Agenda del día");
    expect(screen.queryByText(/Buen momento/)).toBeNull();
    expect(obtenerLupita().gesto).toBeNull();
  });

  it("el gesto sale una vez aunque Hoy se vuelva a leer en la misma visita", () => {
    // Hoy se relee al agendar o cuando una nota termina, sin desmontarse: la
    // línea puede cambiar de texto y el efecto volver a correr.
    const ahora = new Date("2026-09-10T14:00:00Z");
    expect(tocaSaludarHoy(ahora)).toBe(true);
    expect(tocaElGestoDelSaludo()).toBe(true);
    expect(tocaSaludarHoy(ahora)).toBe(true);
    expect(tocaElGestoDelSaludo()).toBe(false);
  });

  it("también al día siguiente de otro día guardado en este dispositivo", async () => {
    window.localStorage.setItem("lupita:saludo", "2026-09-09");
    vi.mocked(leerHoy).mockResolvedValue(dia(false));
    render(<Dashboard />);
    expect(await screen.findByText(/Buen momento/)).toBeTruthy();
  });

  it("un día con riesgo no hay línea ni saludo", async () => {
    vi.mocked(leerHoy).mockResolvedValue(dia(true));
    render(<Dashboard />);
    await screen.findByText("Agenda del día");
    expect(screen.queryByText(/Buen momento/)).toBeNull();
    expect(obtenerLupita().gesto).toBeNull();
  });
});

describe("el cobro", () => {
  async function cobrarEnHoy(riesgo: boolean) {
    // Ya saludó hoy: el gesto que se mire es el del cobro.
    window.localStorage.setItem("lupita:saludo", "2026-09-10");
    vi.mocked(leerHoy).mockResolvedValue(dia(riesgo));
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Efectivo" })); });
    await act(() => new Promise((r) => setTimeout(r, 10)));
  }

  it("cobrar en Hoy hace el gesto cuando el sheet se cerró", async () => {
    await cobrarEnHoy(false);
    expect(obtenerLupita().gesto?.tipo).toBe("cobro");
  });

  it("un día con riesgo, cobrar no la hace celebrar", async () => {
    await cobrarEnHoy(true);
    expect(obtenerLupita().gesto).toBeNull();
  });
});

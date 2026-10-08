// @vitest-environment jsdom
//
// "Volver a escribirla": mientras la sesión está en `procesando`, la nota
// anterior se sigue leyendo —sin edición ni aprobación— bajo un aviso de que
// se está escribiendo de nuevo. Sin nota anterior, el indicador de siempre.
// Cuando el polling trae la nota nueva, reemplaza a la vieja.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "@/lib/api-client";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { SesionDetailView } from "../sesion-detail-view";
import { ESCRIBIENDO_NOTA, REESCRIBIENDO_VERSION_ANTERIOR } from "../textos";

const polling = vi.hoisted(() => ({
  onSesion: null as null | ((e: { fila: SesionClinicaResponse }) => void),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/useSesionClinicaPolling", () => ({
  ESTADOS_ACTIVOS: new Set(["grabando", "subiendo", "procesando"]),
  useSesionClinicaPolling: ({ onSesion }: { onSesion: (e: { fila: SesionClinicaResponse }) => void }) => {
    polling.onSesion = onSesion;
  },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  esAbort: () => false,
}));

const nota = (texto: string) => ({
  subjetivo: `${texto} S`,
  objetivo: `${texto} O`,
  analisis: `${texto} A`,
  plan: `${texto} P`,
});

function sesion(cambios: Partial<SesionClinicaResponse>): SesionClinicaResponse {
  return {
    id: "ses_1",
    turnoId: "t_1",
    estado: "procesando",
    audioEstado: "borrado",
    audioBorradoEn: null,
    duracionAudioSeg: 3000,
    pausas: null,
    intento: 1,
    generacion: 1,
    falloCodigo: null,
    falloDetalle: null,
    transcripcionDisponible: true,
    notaIa: null,
    notaFinal: null,
    notasEdicion: null,
    datos: {},
    feedbackEstado: "no_pedido",
    feedback: null,
    feedbackError: null,
    modeloAsr: "prueba",
    modeloLlm: null,
    promptVersion: null,
    procesadaEn: null,
    aprobadaEn: null,
    creadaEn: "2026-09-07T13:00:00.000Z",
    actualizadaEn: "2026-09-07T13:00:00.000Z",
    turno: {
      id: "t_1",
      fecha: "2026-09-07T13:00:00.000Z",
      paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" },
    },
    ...cambios,
  } as unknown as SesionClinicaResponse;
}

async function abrir(fila: SesionClinicaResponse) {
  vi.mocked(apiGet).mockResolvedValue(fila);
  await act(async () => {
    render(
      <ProteccionTrabajo>
        <SesionDetailView id="ses_1" />
      </ProteccionTrabajo>,
    );
  });
}

beforeEach(() => {
  polling.onSesion = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("nota durante Volver a escribirla", () => {
  it("con nota anterior, la muestra en lectura bajo el aviso, sin editar ni aprobar", async () => {
    await abrir(sesion({ notaIa: nota("VIEJA") }));

    const aviso = screen.getByText(REESCRIBIENDO_VERSION_ANTERIOR);
    const subjetivo = screen.getByText("VIEJA S");
    expect(aviso.compareDocumentPosition(subjetivo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("VIEJA P")).toBeTruthy();
    expect(screen.queryByText(ESCRIBIENDO_NOTA)).toBeNull();

    // Ni edición, ni aprobación, ni volver a escribirla.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Aprobar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Volver a escribirla/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("sin nota anterior, el indicador de siempre", async () => {
    await abrir(sesion({ notaIa: null }));
    expect(screen.getByText(ESCRIBIENDO_NOTA)).toBeTruthy();
    expect(screen.queryByText(REESCRIBIENDO_VERSION_ANTERIOR)).toBeNull();
  });

  it("al terminar, la nota nueva reemplaza a la vieja y vuelve la revisión", async () => {
    await abrir(sesion({ notaIa: nota("VIEJA") }));
    expect(polling.onSesion).not.toBeNull();

    await act(async () => {
      polling.onSesion!({ fila: sesion({ estado: "revision", generacion: 2, notaIa: nota("NUEVA") }) });
    });

    expect(screen.queryByText(REESCRIBIENDO_VERSION_ANTERIOR)).toBeNull();
    expect(screen.queryByText("VIEJA S")).toBeNull();
    expect(screen.getByText("NUEVA S")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Aprobar/ })).toBeTruthy();
  });
});

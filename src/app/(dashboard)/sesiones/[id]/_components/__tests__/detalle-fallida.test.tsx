// @vitest-environment jsdom
//
// Una sesión fallida dice el motivo por su código, en castellano. El detalle
// técnico (falloDetalle, que a veces escribe el worker con recortes del
// pipeline) no se muestra: queda en la consola.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { apiGet } from "@/lib/api-client";
import { NOTA_NO_ESCRITA, SESION_FALLO_LABEL } from "@/lib/glosario";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { SesionDetailView } from "../sesion-detail-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/useSesionClinicaPolling", () => ({
  ESTADOS_ACTIVOS: new Set(["grabando", "subiendo", "procesando"]),
  useSesionClinicaPolling: () => undefined,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  esAbort: () => false,
}));

const DETALLE = "AssemblyAI 500: upstream timeout (chunk 3/7)";

function sesionFallida(falloCodigo: string | null): SesionClinicaResponse {
  return {
    id: "ses_1",
    turnoId: "t_1",
    estado: "fallida",
    audioEstado: "en_r2",
    audioBorradoEn: null,
    duracionAudioSeg: 3000,
    pausas: null,
    intento: 5,
    generacion: 1,
    falloCodigo,
    falloDetalle: DETALLE,
    transcripcionDisponible: false,
    notaIa: null,
    notaFinal: null,
    notasEdicion: null,
    datos: {},
    feedbackEstado: "no_pedido",
    feedback: null,
    feedbackError: null,
    modeloAsr: null,
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
  } as unknown as SesionClinicaResponse;
}

afterEach(() => vi.restoreAllMocks());

describe("sesión fallida", () => {
  it("muestra el motivo por su código y manda el detalle técnico a la consola", async () => {
    vi.mocked(apiGet).mockResolvedValue(sesionFallida("intentos_agotados"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<ProteccionTrabajo><SesionDetailView id="ses_1" /></ProteccionTrabajo>);

    expect(await screen.findByText(NOTA_NO_ESCRITA)).toBeTruthy();
    expect(screen.getByText(SESION_FALLO_LABEL.intentos_agotados)).toBeTruthy();
    expect(document.body.textContent).not.toContain("AssemblyAI");
    await waitFor(() => expect(warn.mock.calls.some(([m]) => String(m).includes(DETALLE))).toBe(true));
  });

  it("con un código sin rótulo no inventa un motivo ni muestra el detalle", async () => {
    vi.mocked(apiGet).mockResolvedValue(sesionFallida("asr_error"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<ProteccionTrabajo><SesionDetailView id="ses_1" /></ProteccionTrabajo>);

    expect(await screen.findByText(NOTA_NO_ESCRITA)).toBeTruthy();
    expect(document.body.textContent).not.toContain("AssemblyAI");
    expect(document.body.textContent).not.toContain("asr_error");
  });
});

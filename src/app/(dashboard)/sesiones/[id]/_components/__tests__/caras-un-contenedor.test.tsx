// @vitest-environment jsdom
//
// Las tres caras de una sesión cuelgan de un solo contenedor, el de
// sesiones/[id]/layout.tsx. Next no vuelve a montar un layout al navegar
// entre sus páginas: acá se monta el layout real y se cambia el segmento de
// la URL, como lo hace Next al navegar, y se cuenta cuántas veces se pidió la
// fila. Antes cada página montaba su contenedor y cada cambio de cara la
// pedía de nuevo, con la transcripción esperando detrás.

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { apiGet } from "@/lib/api-client";
import { PARA_VOS, VISTA_NOTA } from "@/lib/glosario";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import SesionLayout from "../../layout";
import SesionDetallePage from "../../page";
import ParaVosPage from "../../para-vos/page";
import TranscripcionPage from "../../transcripcion/page";

const navegacion = vi.hoisted(() => ({ segmento: null as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegment: () => navegacion.segmento,
}));
vi.mock("@/hooks/useSesionClinicaPolling", () => ({
  ESTADOS_ACTIVOS: new Set(["grabando", "subiendo", "procesando"]),
  useSesionClinicaPolling: () => undefined,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn(async (ruta: string) =>
    ruta.endsWith("/transcripcion") ? { transcripcion: "[00:03] Terapeuta: ¿Cómo estuvo la semana?" } : sesion(),
  ),
  apiPost: vi.fn(),
  esAbort: () => false,
}));

function sesion(): SesionClinicaResponse {
  return {
    id: "ses_1", turnoId: "t_1", estado: "aprobada", generacion: 1, transcripcionDisponible: true,
    notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" }, notaFinal: null, datos: {},
    feedbackEstado: "listo", feedback: null, modeloAsr: null,
    turno: { id: "t_1", fecha: "2026-09-19T01:30:00.000Z", paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" } },
  } as unknown as SesionClinicaResponse;
}

const lecturasDeLaFila = () =>
  vi.mocked(apiGet).mock.calls.filter(([ruta]) => ruta === "/api/sesion-clinica/ses_1");
const lecturasDeLaTranscripcion = () =>
  vi.mocked(apiGet).mock.calls.filter(([ruta]) => ruta === "/api/sesion-clinica/ses_1/transcripcion");

/** El árbol que arma Next: el layout de [id] con la página de la cara. */
async function arbol(pagina: React.ReactNode) {
  const layout = await SesionLayout({ params: Promise.resolve({ id: "ses_1" }), children: pagina });
  return <ProteccionTrabajo>{layout}</ProteccionTrabajo>;
}

beforeEach(() => {
  vi.mocked(apiGet).mockClear();
  navegacion.segmento = null;
});

describe("sesiones/[id]: un solo contenedor para las tres caras", () => {
  it("cambiar de cara no vuelve a pedir la fila", async () => {
    const vista = render(await arbol(<SesionDetallePage />));
    await screen.findByRole("heading", { level: 1, name: "Lucía Fernández" });
    expect(lecturasDeLaFila()).toHaveLength(1);

    navegacion.segmento = "para-vos";
    vista.rerender(await arbol(<ParaVosPage />));
    await waitFor(() => expect(screen.getByRole("tab", { name: PARA_VOS }).getAttribute("aria-selected")).toBe("true"));

    navegacion.segmento = "transcripcion";
    vista.rerender(await arbol(<TranscripcionPage />));
    expect(await screen.findByText("¿Cómo estuvo la semana?")).toBeTruthy();

    navegacion.segmento = null;
    vista.rerender(await arbol(<SesionDetallePage />));
    await waitFor(() => expect(screen.getByRole("tab", { name: VISTA_NOTA }).getAttribute("aria-selected")).toBe("true"));

    expect(lecturasDeLaFila()).toHaveLength(1);
    // La transcripción se pidió una vez, al abrirla, sin esperar a otra
    // lectura de la fila.
    expect(lecturasDeLaTranscripcion()).toHaveLength(1);
  });

  it("entrar por la URL de una cara la muestra, con una sola lectura de la fila", async () => {
    navegacion.segmento = "transcripcion";
    render(await arbol(<TranscripcionPage />));
    expect(await screen.findByText("¿Cómo estuvo la semana?")).toBeTruthy();
    expect(lecturasDeLaFila()).toHaveLength(1);
  });
});

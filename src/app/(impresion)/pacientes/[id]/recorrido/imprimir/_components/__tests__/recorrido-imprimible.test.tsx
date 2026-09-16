// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

import { apiPost } from "@/lib/api-client";
import { hiloVacio, type ContenidoHilo, type ResumenVersionHilo } from "@/lib/hilo/contenido";

import { RecorridoImprimible } from "../recorrido-imprimible";

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));

const SESION_A = "7b0c7e0a-1c4e-4d8a-9a51-0f5d7a9b2c11";
const SESION_B = "c3d9a4f2-6b1e-4f7a-8c2d-5e6f7a8b9c01";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const contenido = (resumen: string): ContenidoHilo => ({
  ...hiloVacio(),
  resumenAcumulativo: resumen,
  intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "alta", sesiones: [SESION_A, SESION_B] }],
  riesgosHistoricos: [{ sesionId: SESION_B, fecha: "2026-08-20", flag: "autolesion", detalle: "Lo mencionó al pasar" }],
});

const version = (v: Partial<ResumenVersionHilo> & { version: number }): ResumenVersionHilo => ({
  id: `00000000-0000-4000-8000-00000000000${v.version}`,
  basadaEnVersion: null, actor: "profesional", estado: "aplicada", sesionOrigenId: null,
  creadaPorUserId: null, creadaEn: "2026-08-01T15:00:00.000Z", resueltaEn: null,
  resueltaPorUserId: null, propuestaOrigenId: null, ...v,
});

function exportacion() {
  const v1 = version({ version: 1, actor: "ia", sesionOrigenId: SESION_A });
  const v2 = version({ version: 2, propuestaOrigenId: v1.id, sesionOrigenId: SESION_A, resueltaEn: "2026-08-02T12:00:00.000Z" });
  const v3 = version({ version: 3, creadaEn: "2026-08-25T12:00:00.000Z" });
  const v4 = version({ version: 4, actor: "ia", estado: "propuesta", sesionOrigenId: SESION_B });
  return {
    paciente: { nombre: "Ana", apellido: "Pérez" },
    nombreProfesional: "Lic. Prueba",
    exportadoEn: "2026-09-16T17:30:00.000Z",
    vigente: { ...v3, contenido: contenido("Versión tres") },
    anteriores: [{ ...v2, contenido: contenido("Versión dos") }],
    versiones: [v4, v3, v2, v1],
    sesiones: [{ id: SESION_A, fecha: "2026-08-01T14:00:00.000Z" }, { id: SESION_B, fecha: "2026-08-20T14:00:00.000Z" }],
    progreso: { pacienteId: "p", totalSesiones: 2, rango: "todo", sesiones: [], temas: [], riesgos: [] },
  };
}

beforeEach(() => {
  vi.mocked(apiPost).mockResolvedValue(exportacion());
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("la hoja del Recorrido", () => {
  it("pide la exportación una vez y abre el diálogo de impresión una vez", async () => {
    const { rerender } = render(<RecorridoImprimible pacienteId="p" />);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    rerender(<RecorridoImprimible pacienteId="p" />);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/api/pacientes/p/hilo/exportar", {});
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("muestra fechas legibles y ningún identificador", async () => {
    const { container } = render(<RecorridoImprimible pacienteId="p" />);
    await screen.findByRole("heading", { level: 1, name: "Ana Pérez" });
    expect(container.textContent).not.toMatch(UUID);
    expect(screen.getAllByText("Nota del 1 de agosto de 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nota del 20 de agosto de 2026").length).toBeGreaterThan(0);
  });

  it("lleva la vigente y las anteriores completas, y el historial con estados legibles", async () => {
    render(<RecorridoImprimible pacienteId="p" />);
    await screen.findByText("Versión tres");
    expect(screen.getByText("Versión dos")).toBeTruthy();

    const historial = screen.getByRole("heading", { name: "Historial de versiones" }).closest("section")!;
    const filas = within(historial).getAllByRole("row").slice(1).map((fila) => within(fila).getAllByRole("cell").map((c) => c.textContent));
    expect(filas.map((f) => [f[0], f[2], f[3], f[4]])).toEqual([
      ["4", "Propuesta de la IA", "Sin revisar", "20 ago 2026"],
      ["3", "Edición tuya", "Vigente", "—"],
      ["2", "Edición tuya", "Estuvo vigente", "1 ago 2026"],
      ["1", "Propuesta de la IA", "Aceptada con tus ediciones (versión 2)", "1 ago 2026"],
    ]);
  });

  it("con menos de tres sesiones no dibuja gráficos y lo dice", async () => {
    render(<RecorridoImprimible pacienteId="p" />);
    expect(await screen.findByText("Todavía no hay suficiente recorrido.")).toBeTruthy();
  });

  it("si la exportación falla, lo dice y no abre el diálogo", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("No autorizado"));
    render(<RecorridoImprimible pacienteId="p" />);
    expect((await screen.findByRole("alert")).textContent).toBe("No autorizado");
    expect(window.print).not.toHaveBeenCalled();
  });
});

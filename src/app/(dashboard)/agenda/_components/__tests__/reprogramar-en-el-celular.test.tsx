// @vitest-environment jsdom
//
// Reprogramar desde el teléfono. En producción (Edge a 390 px) el sheet decía
// "Turno reprogramado" y el turno se quedaba con la hora vieja, y la nota
// escrita no llegaba a ningún lado.
//
// La prueba monta el detalle como lo ve un celular —el primer panel del
// sheet, que es el que el teléfono muestra—, cambia la hora y la nota ahí
// adentro, y mira lo único que importa: qué cuerpo sale hacia la API.
import * as React from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnoDetailSheet } from "../turno-detail-sheet";
import { horaInputMvd } from "@/lib/fechas-montevideo";
import type { TurnoConPaciente } from "@/types/domain";

const { apiGet, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet,
  apiPatch,
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

// El brief del paciente pide por su cuenta; no es lo que se prueba acá.
vi.mock("@/components/clinico/brief-corto", () => ({
  BriefCortoDePaciente: () => null,
}));

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
});

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue([]);
  apiPatch.mockReset().mockResolvedValue({});
});

// 2026-10-01 15:15 de Montevideo (UTC-3 fijo).
const TURNO = {
  id: "turno-1",
  pacienteId: "pac-1",
  fecha: new Date("2026-10-01T18:15:00.000Z"),
  duracion: 50,
  modalidad: "presencial",
  estado: "programado",
  notas: "Traía la carpeta",
  tarifaCobrada: 2200,
  pagoEstado: "pendiente",
  pagoFecha: null,
  pagoMetodo: null,
  serieId: null,
  creadoEn: new Date("2026-09-01T12:00:00.000Z"),
  actualizadoEn: new Date("2026-09-01T12:00:00.000Z"),
  paciente: { id: "pac-1", nombre: "Lucía", apellido: "Prueba" },
} as unknown as TurnoConPaciente;

/** El panel que el teléfono muestra. */
function panelDelCelular() {
  return document.querySelectorAll<HTMLElement>('[role="dialog"]')[0];
}

describe("Reprogramar desde el celular", () => {
  it("manda la hora y la nota que se escribieron en la pantalla", async () => {
    render(
      <TurnoDetailSheet
        open
        turno={TURNO}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    const celular = within(panelDelCelular());
    fireEvent.click(celular.getByRole("button", { name: "Reprogramar" }));

    fireEvent.change(celular.getByLabelText("Hora"), { target: { value: "16:30" } });
    fireEvent.change(celular.getByLabelText("Notas"), {
      target: { value: "Trae el informe" },
    });

    fireEvent.click(celular.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(apiPatch).toHaveBeenCalled());

    const [ruta, cuerpo] = apiPatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(ruta).toBe("/api/turnos/turno-1");
    expect(horaInputMvd(new Date(cuerpo.fecha as string))).toBe("16:30");
    expect(cuerpo.notas).toBe("Trae el informe");
  });
});

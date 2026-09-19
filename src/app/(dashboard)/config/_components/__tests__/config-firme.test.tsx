// @vitest-environment jsdom
// A: al abrir, el editor y "Así lo recibe la paciente" muestran la misma
// plantilla. B: un cambio no se pierde por salir antes del autoguardado, y un
// campo inválido no frena a los válidos.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSmsMessage, prepararPlantillaRecordatorio } from "@/lib/sms/texto";

import { htmlATemplate } from "../editor-recordatorio";
import { ConfigView } from "../config-view";

// El default de la columna (prisma/schema.prisma): lo que tiene guardado toda
// organización que nunca tocó el recordatorio.
const DEFAULT_DE_LA_BASE =
  "Hola {{nombre}}. Te recordamos tu sesión:\n{{fecha}}  |  {{hora}}\n{{direccion}}\n\nCualquier cambio, avisame con anticipación. Gracias.";

const api = vi.hoisted(() => ({ patch: vi.fn(), config: {} as Record<string, unknown> }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPatch: api.patch,
  apiGet: async () => api.config,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../vocabulario-seccion", () => ({ VocabularioSeccion: () => null }));
vi.mock("../invitar-colega", () => ({ InvitarColega: () => null }));

const datos = { nombreProfesional: "Mariana Roldán", direccion: "Calle 123", whatsappOrigen: "099123456" };

beforeEach(() => {
  vi.useFakeTimers();
  api.patch.mockReset();
  api.patch.mockResolvedValue({});
  api.config = { ...datos, tarifaDefault: 1500, recordatorioModo: "dia_anterior", templateRecordatorio: DEFAULT_DE_LA_BASE, orientacionTeorica: "gestalt" };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function abrir() {
  let vista!: ReturnType<typeof render>;
  await act(async () => {
    vista = render(<ConfigView />);
  });
  return vista;
}

describe("A: editor y vista previa coinciden al abrir", () => {
  it.each([
    ["el default de la base", DEFAULT_DE_LA_BASE],
    ["una plantilla personalizada", "Hola {{nombre}}, te espero el {{fecha}}."],
  ])("con %s", async (_caso, guardada) => {
    api.config.templateRecordatorio = guardada;
    await abrir();
    const enElEditor = htmlATemplate(screen.getByRole("textbox", { name: "Mensaje del recordatorio" }));
    const vistaPrevia = screen.getByRole("region", { name: "Vista previa del SMS" }).textContent;
    // La vista previa es la plantilla del editor con los datos del ejemplo:
    // lo que ella lee arriba es lo que la paciente recibe abajo.
    expect(vistaPrevia).toBe(
      buildSmsMessage(enElEditor, {
        nombre: "Lucía", apellido: "Fernández", fecha: new Date("2026-04-21T10:00:00-03:00"),
        direccion: datos.direccion, profesional: datos.nombreProfesional, telefonoConsultorio: datos.whatsappOrigen,
      }),
    );
    expect(enElEditor).toBe(prepararPlantillaRecordatorio(guardada));
    // Abrir no guarda nada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe("B: los cambios no se pierden", () => {
  it("salir de la pantalla antes del autoguardado envía el cambio", async () => {
    const vista = await abrir();
    fireEvent.change(screen.getByLabelText("Dirección del consultorio"), { target: { value: "Otra 456" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.patch).not.toHaveBeenCalled();
    await act(async () => {
      vista.unmount();
    });
    expect(api.patch).toHaveBeenCalledExactlyOnceWith("/api/config", { direccion: "Otra 456" });
  });

  it("un cambio escrito mientras viajaba el anterior también sale al irse", async () => {
    let terminar!: () => void;
    api.patch.mockImplementationOnce(() => new Promise<void>((r) => { terminar = r; }));
    const vista = await abrir();
    const direccion = screen.getByLabelText("Dirección del consultorio");
    fireEvent.change(direccion, { target: { value: "Primera" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    fireEvent.change(direccion, { target: { value: "Segunda" } });
    await act(async () => {
      vista.unmount();
    });
    await act(async () => {
      terminar();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.patch).toHaveBeenLastCalledWith("/api/config", { direccion: "Segunda" });
  });

  it("un campo inválido no frena a los válidos del mismo lote", async () => {
    await abrir();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Lo que cobrás por sesión" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Dirección del consultorio"), { target: { value: "Otra 456" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(api.patch).toHaveBeenCalledExactlyOnceWith("/api/config", { direccion: "Otra 456" });
    expect(screen.getByText("Hay cambios sin guardar. Revisá los datos y reintentá.")).toBeTruthy();
  });
});

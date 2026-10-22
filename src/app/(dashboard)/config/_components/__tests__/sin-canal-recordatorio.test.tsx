// @vitest-environment jsdom
// Sólo WhatsApp: el SMS ya no existe, Tu consultorio no ofrece elegir cómo
// se recuerdan los turnos y no habla de SMS.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConfigView } from "../config-view";

const api = vi.hoisted(() => ({ patch: vi.fn(), config: {} as Record<string, unknown> }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPatch: api.patch,
  apiGet: async () => api.config,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../vocabulario-seccion", () => ({ VocabularioSeccion: () => null }));
vi.mock("../invitar-colega", () => ({ InvitarColega: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  api.patch.mockReset();
  api.patch.mockResolvedValue({});
  api.config = {
    nombreProfesional: "Mariana Roldán",
    direccion: "Calle 123",
    whatsappOrigen: "099123456",
    tarifaDefault: 1500,
    recordatorioModo: "dia_anterior",
    templateRecordatorio: "Hola {{nombre}}",
    orientacionTeorica: "gestalt",
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function abrir() {
  await act(async () => {
    render(<ConfigView />);
  });
}

it("no ofrece elegir el canal ni habla de SMS", async () => {
  await abrir();
  expect(screen.queryByRole("group", { name: "Cómo recordás los turnos" })).toBeNull();
  expect(screen.queryByRole("radio", { name: /SMS automático|^Ambos|WhatsApp desde mi teléfono/ })).toBeNull();
  expect(screen.getByRole("region", { name: "Vista previa del mensaje" })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/SMS/);
});

it("guardar el recordatorio no manda el canal", async () => {
  await abrir();
  fireEvent.click(screen.getByRole("radio", { name: /La misma mañana/ }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(api.patch).toHaveBeenCalledWith("/api/config", { recordatorioModo: "misma_manana" });
});

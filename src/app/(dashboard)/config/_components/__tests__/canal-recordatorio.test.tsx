// @vitest-environment jsdom
// Sólo WhatsApp (CANAL_RECORDATORIO_VIGENTE): Tu consultorio ya no ofrece
// elegir cómo se recuerdan los turnos, y con cualquier valor guardado el
// recordatorio se lee y se edita como WhatsApp.
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
    canalRecordatorio: "sms",
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

it.each(["sms", "ambos", "whatsapp"])("con %s guardado no ofrece elegir el canal ni habla de SMS", async (guardado) => {
  api.config.canalRecordatorio = guardado;
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

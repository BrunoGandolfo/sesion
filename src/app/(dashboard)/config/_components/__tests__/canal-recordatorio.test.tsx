// @vitest-environment jsdom
// "Cómo recordás los turnos": muestra el canal guardado (la API siempre lo
// trae: la columna es NOT NULL con default sms) y elegir otro lo guarda con
// el autoguardado de siempre.
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

function grupo() {
  return screen.getByRole("group", { name: "Cómo recordás los turnos" });
}

it("ofrece los tres modos, cada uno con su línea, y marca el guardado (SMS por defecto)", async () => {
  await abrir();
  const radios = Array.from(grupo().querySelectorAll<HTMLInputElement>("input[type=radio]"));
  expect(radios.map((r) => r.value)).toEqual(["sms", "whatsapp", "ambos"]);
  expect(screen.getByRole("radio", { name: /^SMS automático/ })).toHaveProperty("checked", true);
  expect(
    screen.getByText("La app te prepara el mensaje y lo mandás vos; las respuestas te llegan a tu WhatsApp."),
  ).toBeTruthy();
});

it("muestra el canal guardado", async () => {
  api.config.canalRecordatorio = "ambos";
  await abrir();
  expect(screen.getByRole("radio", { name: /^Ambos/ })).toHaveProperty("checked", true);
});

it("elegir WhatsApp lo guarda", async () => {
  await abrir();
  fireEvent.click(screen.getByRole("radio", { name: /WhatsApp desde mi teléfono/ }));
  expect(screen.getByRole("radio", { name: /WhatsApp desde mi teléfono/ })).toHaveProperty("checked", true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(api.patch).toHaveBeenCalledWith("/api/config", { canalRecordatorio: "whatsapp" });
});

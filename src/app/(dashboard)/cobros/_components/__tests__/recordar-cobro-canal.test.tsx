// @vitest-environment jsdom

// Te deben: el recordatorio de cobro con la plantilla de Tu consultorio.
// Lo único simulado es la red.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RECORDAR_COBRO_TITULO } from "@/lib/glosario";

import { CobrosView } from "../cobros-view";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

const LUCIA = "Lucía Fernández";

function servidor(config: Record<string, unknown>) {
  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/dashboard") return { kpis: { sesionesHoy: 0, deudaAcumulada: 4500, ingresosMes: 0 } };
    if (url === "/api/deudores") {
      return [{
        pacienteId: "p1", nombre: "Lucía", apellido: "Fernández", telefono: "+59899123456",
        sesionesImpagas: 2, montoTotal: 4500, minutosTotales: 100, diasAtraso: 11, ultimoAvisoEn: null,
      }];
    }
    if (url === "/api/turnos/cobros") return [];
    if (url === "/api/config") return config;
    throw new Error("GET inesperado: " + url);
  });
}

async function abrirRecordatorio() {
  render(<CobrosView />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Recordar cobro a ${LUCIA}`) }));
  return screen.findByText(RECORDAR_COBRO_TITULO);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe("Te deben: la plantilla del aviso de cobro", () => {
  it("la vista previa usa la plantilla de Tu consultorio", async () => {
    servidor({
      nombreProfesional: "Mariana",
      templateCobro: "Hola {{nombre}} {{apellido}}, quedan {{sesiones}} sesiones por {{monto}}. {{profesional}}",
      direccion: "",
      whatsappOrigen: "",
      canalRecordatorio: "sms",
    });
    await abrirRecordatorio();
    expect(screen.getByText("Hola Lucía Fernández, quedan 2 sesiones por $ 4.500. Mariana")).toBeTruthy();
  });

  it("sin plantilla guardada sale el texto de siempre", async () => {
    servidor({ nombreProfesional: "Mariana" });
    await abrirRecordatorio();
    expect(screen.getByText(/Lucía, tenés 2 sesiones pendientes de pago: \$ 4\.500\./)).toBeTruthy();
  });
});

// @vitest-environment jsdom

// Te deben: el recordatorio de cobro con la plantilla de Tu consultorio y
// por el canal elegido. Lo único simulado es la red (y window.open).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { textoDelCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import {
  ABRIR_WHATSAPP,
  AVISO_COBRO_PROGRAMADO,
  AVISO_COBRO_WHATSAPP_ANOTADO,
  ENVIAR_SMS,
  NO_SE_ANOTO_AVISO,
  RECORDAR_COBRO,
  RECORDAR_COBRO_TITULO,
  RECORDAR_COBRO_WHATSAPP,
} from "@/lib/glosario";

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

const estado = { ultimoAvisoEn: null as string | null };

function servidor(config: Record<string, unknown>) {
  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/dashboard") return { kpis: { sesionesHoy: 0, deudaAcumulada: 4500, ingresosMes: 0 } };
    if (url === "/api/deudores") {
      return [{
        pacienteId: "p1", nombre: "Lucía", apellido: "Fernández", telefono: "+59899123456",
        sesionesImpagas: 2, montoTotal: 4500, minutosTotales: 100, diasAtraso: 11, ultimoAvisoEn: estado.ultimoAvisoEn,
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
  await screen.findByText(RECORDAR_COBRO_TITULO);
  return screen.getByRole("alertdialog");
}

const CONFIG = {
  nombreProfesional: "Mariana",
  templateCobro: TEMPLATE_COBRO_DEFAULT,
  direccion: "",
  whatsappOrigen: "",
};
const TEXTO = textoDelCobro(
  { ...CONFIG },
  { nombre: "Lucía", apellido: "Fernández" },
  { sesiones: 2, monto: 4500 },
);
const abrir = vi.fn();

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  estado.ultimoAvisoEn = null;
  abrir.mockReset();
  vi.spyOn(window, "open").mockImplementation(abrir);
});
afterEach(() => vi.restoreAllMocks());

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

describe("Te deben: el botón según el canal", () => {
  it.each(["sms", "ambos"])("con %s, todo dice SMS y sale por SMS como siempre", async (canal) => {
    servidor({ ...CONFIG, canalRecordatorio: canal });
    api.post.mockResolvedValue({ canal: "sms", envioId: "e1", creado: true, programadoEn: "2026-09-03T15:00:00.000Z", sesiones: 2, monto: 4500 });
    render(<CobrosView />);
    const boton = await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por SMS` });
    expect(boton.textContent).toBe(RECORDAR_COBRO);
    fireEvent.click(boton);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: ENVIAR_SMS }));
    await waitFor(() => expect(screen.getAllByRole("status").some((n) => n.textContent === AVISO_COBRO_PROGRAMADO)).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", {});
    expect(abrir).not.toHaveBeenCalled();
  });

  it("con WhatsApp, ningún texto dice SMS, abre WhatsApp con la plantilla y la fila queda Avisada", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    const enlace = `https://wa.me/59899123456?text=${encodeURIComponent(TEXTO)}`;
    api.post.mockImplementation(async () => {
      // WhatsApp se abre ANTES de esperar al servidor: el navegador sólo deja
      // abrir una ventana dentro del toque.
      expect(abrir).toHaveBeenCalledWith(enlace, "_blank", "noopener");
      estado.ultimoAvisoEn = new Date().toISOString();
      return { canal: "whatsapp", enlace, avisadoEn: estado.ultimoAvisoEn, sesiones: 2, monto: 4500 };
    });
    render(<CobrosView />);
    const boton = await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por WhatsApp` });
    expect(boton.textContent).toBe(RECORDAR_COBRO_WHATSAPP);
    fireEvent.click(boton);
    const panel = screen.getByRole("alertdialog");
    expect(panel.textContent).toContain(TEXTO);
    expect(document.body.textContent).not.toMatch(/SMS/);
    fireEvent.click(within(panel).getByRole("button", { name: ABRIR_WHATSAPP }));
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", {});
    await waitFor(() => expect(screen.getAllByRole("status").some((n) => n.textContent === AVISO_COBRO_WHATSAPP_ANOTADO)).toBe(true));
    // Vuelve a leer la lista: "Avisado hoy" sale del servidor, como con el SMS.
    expect(await screen.findByText("Avisado hoy")).toBeTruthy();
  });

  it("con WhatsApp, si anotarlo falla, WhatsApp se abrió igual y lo dice", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    api.post.mockRejectedValue(new ApiClientError("Error del servidor", 500));
    const panel = await abrirRecordatorio();
    fireEvent.click(within(panel).getByRole("button", { name: ABRIR_WHATSAPP }));
    expect(abrir).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByRole("status").some((n) => n.textContent === NO_SE_ANOTO_AVISO)).toBe(true));
  });
});

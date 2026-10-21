// @vitest-environment jsdom

// Te deben: el recordatorio de cobro con la plantilla de Tu consultorio, sólo
// por WhatsApp. Lo único simulado es la red (y window.open).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { textoDelCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import {
  MOTIVO_PACIENTE_DADA_DE_BAJA,
  ABRIR_WHATSAPP,
  AVISO_COBRO_WHATSAPP_ANOTADO,
  NO_SE_ANOTO_AVISO,
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

const estado = { ultimoAvisoEn: null as string | null, dadaDeBaja: false };

function servidor(config: Record<string, unknown>) {
  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/dashboard") return { kpis: { sesionesHoy: 0, deudaAcumulada: 4500, ingresosMes: 0 } };
    if (url === "/api/deudores") {
      return [{
        pacienteId: "p1", nombre: "Lucía", apellido: "Fernández", telefono: "+59899123456",
        sesionesImpagas: 2, montoTotal: 4500, minutosTotales: 100, diasAtraso: 11, ultimoAvisoEn: estado.ultimoAvisoEn, dadaDeBaja: estado.dadaDeBaja,
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
// "Avisado hoy" depende del día: la hora queda fija.
const AHORA = new Date("2026-09-03T15:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  api.get.mockReset();
  api.post.mockReset();
  estado.ultimoAvisoEn = null;
  estado.dadaDeBaja = false;
  abrir.mockReset();
  vi.spyOn(window, "open").mockImplementation(abrir);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("Te deben: sin la configuración no se ofrece el aviso", () => {
  it("si /api/config falla, la fila tiene Registrar pago pero no Recordar cobro", async () => {
    servidor(CONFIG);
    const leer = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => {
      if (url === "/api/config") throw new ApiClientError("Error del servidor", 500);
      return leer(url);
    });
    render(<CobrosView />);
    expect(await screen.findByRole("button", { name: `Registrar pago de ${LUCIA}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Recordar cobro a/ })).toBeNull();
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("Te deben: el botón según el canal", () => {
  // Sólo WhatsApp (CANAL_RECORDATORIO_VIGENTE): aunque la configuración
  // traiga otro canal, el botón es el de WhatsApp y nunca se pide un SMS.
  it.each(["sms", "ambos", undefined])("con %s en la configuración, el botón es el de WhatsApp", async (canal) => {
    servidor({ ...CONFIG, canalRecordatorio: canal });
    api.post.mockResolvedValue({ canal: "whatsapp", enlace: "https://wa.me/59899123456", avisadoEn: AHORA.toISOString(), sesiones: 2, monto: 4500 });
    render(<CobrosView />);
    const boton = await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por WhatsApp` });
    expect(boton.textContent).toBe(RECORDAR_COBRO_WHATSAPP);
    fireEvent.click(boton);
    expect(document.body.textContent).not.toMatch(/SMS/);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: ABRIR_WHATSAPP }));
    expect(api.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", { canal: "whatsapp" });
  });

  it("con WhatsApp, ningún texto dice SMS, abre WhatsApp con la plantilla y la fila queda Avisada", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    const enlace = `https://wa.me/59899123456?text=${encodeURIComponent(TEXTO)}`;
    api.post.mockImplementation(async () => {
      // WhatsApp se abre ANTES de esperar al servidor: el navegador sólo deja
      // abrir una ventana dentro del toque.
      expect(abrir).toHaveBeenCalledWith(enlace, "_blank", "noopener");
      estado.ultimoAvisoEn = AHORA.toISOString();
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
    expect(api.post).toHaveBeenCalledWith("/api/pacientes/p1/recordar-cobro", { canal: "whatsapp" });
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

  it("con WhatsApp, si el servidor lo rechaza (ya no debe, canal cambiado) dice por qué, no 'no quedó anotado'", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    api.post.mockRejectedValue(new ApiClientError("Esta paciente no tiene sesiones sin cobrar", 409));
    const panel = await abrirRecordatorio();
    fireEvent.click(within(panel).getByRole("button", { name: ABRIR_WHATSAPP }));
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((n) => n.textContent === "Esta paciente no tiene sesiones sin cobrar")).toBe(true),
    );
  });

  it("con WhatsApp, un doble toque abre una sola vez", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    api.post.mockReturnValue(new Promise(() => {}));
    const panel = await abrirRecordatorio();
    const boton = within(panel).getByRole("button", { name: ABRIR_WHATSAPP });
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("con WhatsApp, a quien pidió la baja no se le abre: lo dice el servidor", async () => {
    servidor({ ...CONFIG, canalRecordatorio: "whatsapp" });
    estado.dadaDeBaja = true;
    api.post.mockRejectedValue(new ApiClientError(MOTIVO_PACIENTE_DADA_DE_BAJA, 409));
    const panel = await abrirRecordatorio();
    fireEvent.click(within(panel).getByRole("button", { name: ABRIR_WHATSAPP }));
    await waitFor(() => expect(screen.getAllByRole("status").some((n) => n.textContent === MOTIVO_PACIENTE_DADA_DE_BAJA)).toBe(true));
    expect(abrir).not.toHaveBeenCalled();
  });
});

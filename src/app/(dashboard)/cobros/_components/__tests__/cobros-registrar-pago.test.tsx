// @vitest-environment jsdom

// Te deben: registrar el pago sin salir de Cobros, y el recordatorio por SMS
// como acción secundaria que no sale sin confirmar.
//
// El selector de método es el de verdad (sheet-metodo-pago.tsx, el mismo de
// Hoy): lo único simulado es la red.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import {
  COBRADO,
  COBRO_INCOMPLETO,
  ELEGIR_METODO_DE_PAGO,
  ENVIAR_SMS,
  MARCAR_TODAS,
  RECORDAR_COBRO,
  RECORDAR_COBRO_TITULO,
  REGISTRAR_PAGO,
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

/** El servidor de mentira: dos sesiones realizadas sin cobrar, una ya pagada
 *  y una agendada. Cobrar una la pasa a pagada, y todo lo demás se recalcula
 *  desde ahí, como en la API de verdad. */
function servidor() {
  const turnos = [
    { id: "t-viejo", fecha: "2026-09-02T13:00:00.000Z", estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2000 },
    { id: "t-nuevo", fecha: "2026-09-09T13:00:00.000Z", estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2500 },
    { id: "t-pago", fecha: "2026-08-26T13:00:00.000Z", estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 2000 },
    { id: "t-futuro", fecha: "2026-10-07T13:00:00.000Z", estado: "programado", pagoEstado: "pendiente", tarifaCobrada: 2500 },
  ];
  const impagos = () => turnos.filter((t) => t.estado === "realizado" && t.pagoEstado === "pendiente");
  const suma = (lista: typeof turnos) => lista.reduce((n, t) => n + t.tarifaCobrada, 0);

  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/dashboard") {
      return { kpis: { sesionesHoy: 0, deudaAcumulada: suma(impagos()), ingresosMes: 10000 + 4500 - suma(impagos()) } };
    }
    if (url === "/api/deudores") {
      return impagos().length === 0 ? [] : [{
        pacienteId: "p1", nombre: "Lucía", apellido: "Fernández", telefono: "+59899123456",
        sesionesImpagas: impagos().length, montoTotal: suma(impagos()), minutosTotales: 100,
        diasAtraso: 11, ultimoAvisoEn: null,
      }];
    }
    if (url === "/api/turnos/cobros") return [];
    if (url === "/api/config") return { nombreProfesional: "Mariana" };
    if (url === "/api/pacientes/p1") return { paciente: { id: "p1" }, turnos };
    throw new Error("GET inesperado: " + url);
  });
  return turnos;
}

async function abrirRegistrarPago() {
  render(<CobrosView />);
  fireEvent.click(await screen.findByRole("button", { name: `${REGISTRAR_PAGO} de ${LUCIA}` }));
  return screen.findByRole("region", { name: "¿Qué sesiones te pagó?" });
}

async function elegirMetodo(nombre: string) {
  fireEvent.click(screen.getByRole("button", { name: ELEGIR_METODO_DE_PAGO }));
  const sheet = await screen.findByRole("dialog", { name: "Método de pago" });
  await act(async () => {
    fireEvent.click(within(sheet).getByRole("button", { name: nombre }));
  });
}

const cobros = () => api.post.mock.calls.filter(([ruta]) => /\/cobrar$/.test(ruta));
const smsPedidos = () => api.post.mock.calls.filter(([ruta]) => /recordar-cobro$/.test(ruta));

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe("Te deben: registrar pago", () => {
  it("muestra las sesiones sin cobrar con fecha y monto, cobra la elegida y actualiza deuda e ingresos sin salir de Cobros", async () => {
    const turnos = servidor();
    api.post.mockImplementation(async (ruta: string) => {
      const id = ruta.split("/")[3];
      turnos.find((t) => t.id === id)!.pagoEstado = "pagado";
      return { id };
    });

    const panel = await abrirRegistrarPago();

    // Solo las dos impagas, de la más vieja a la más nueva; ninguna marcada.
    const casillas = await within(panel).findAllByRole("checkbox");
    expect(casillas.map((c) => c.closest("label")!.textContent)).toEqual([
      "Sesión del miércoles 2 de septiembre$ 2.000",
      "Sesión del miércoles 9 de septiembre$ 2.500",
    ]);
    expect(casillas.every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    // Sin nada marcado no se puede seguir.
    expect((screen.getByRole("button", { name: ELEGIR_METODO_DE_PAGO }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(casillas[0]);
    expect(within(panel).getByText("1 sesión · $ 2.000")).toBeTruthy();
    await elegirMetodo("Transferencia");

    expect(cobros()).toEqual([["/api/turnos/t-viejo/cobrar", { metodo: "transferencia" }]]);
    // El único texto de confirmación: el del glosario.
    expect(await screen.findByText(COBRADO)).toBeTruthy();
    // La deuda y lo cobrado en el mes se volvieron a pedir y cambiaron.
    await waitFor(() => {
      expect(document.body.textContent).toContain("Es 1 sesión sin cobrar.");
    });
    expect(screen.getAllByText("$ 2.500").length).toBeGreaterThan(0); // Sin cobrar
    expect(screen.getByText("$ 12.000")).toBeTruthy(); // Cobraste este mes
    // El panel se cerró y la fila vuelve a ofrecer la acción.
    expect(screen.queryByRole("region", { name: "¿Qué sesiones te pagó?" })).toBeNull();
    expect(screen.getByRole("button", { name: `${REGISTRAR_PAGO} de ${LUCIA}` })).toBeTruthy();
    expect(smsPedidos()).toEqual([]);
  });

  it("con 'Marcar todas' cobra cada sesión con el mismo método y la paciente sale de la lista", async () => {
    const turnos = servidor();
    api.post.mockImplementation(async (ruta: string) => {
      turnos.find((t) => t.id === ruta.split("/")[3])!.pagoEstado = "pagado";
      return {};
    });

    const panel = await abrirRegistrarPago();
    fireEvent.click(await within(panel).findByRole("button", { name: MARCAR_TODAS }));
    expect(within(panel).getByText("2 sesiones · $ 4.500")).toBeTruthy();
    await elegirMetodo("Efectivo");

    expect(cobros()).toEqual([
      ["/api/turnos/t-viejo/cobrar", { metodo: "efectivo" }],
      ["/api/turnos/t-nuevo/cobrar", { metodo: "efectivo" }],
    ]);
    expect(await screen.findByText("Nadie te debe")).toBeTruthy();
  });

  it("si una falla en el medio, dice cuántas quedaron y no confirma el cobro", async () => {
    const turnos = servidor();
    api.post.mockImplementation(async (ruta: string) => {
      const id = ruta.split("/")[3];
      if (id === "t-nuevo") throw new ApiClientError("El turno ya está cobrado", 400);
      turnos.find((t) => t.id === id)!.pagoEstado = "pagado";
      return {};
    });

    const panel = await abrirRegistrarPago();
    fireEvent.click(await within(panel).findByRole("button", { name: MARCAR_TODAS }));
    await elegirMetodo("Efectivo");

    expect(await screen.findByText(COBRO_INCOMPLETO(1, 2))).toBeTruthy();
    expect(screen.queryByText(COBRADO)).toBeNull();
    await waitFor(() => {
      expect(document.body.textContent).toContain("Es 1 sesión sin cobrar.");
    });
  });

  it("cerrar el selector sin elegir método no cobra nada y deja lo marcado", async () => {
    servidor();
    const panel = await abrirRegistrarPago();
    fireEvent.click((await within(panel).findAllByRole("checkbox"))[1]);
    fireEvent.click(screen.getByRole("button", { name: ELEGIR_METODO_DE_PAGO }));
    const sheet = await screen.findByRole("dialog", { name: "Método de pago" });
    fireEvent.keyDown(sheet, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Método de pago" })).toBeNull());
    expect(cobros()).toEqual([]);
    expect((within(panel).getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);
  });
});

describe("Te deben: recordar el cobro por SMS", () => {
  it("el botón dice que manda un SMS y tocarlo no envía nada: primero muestra el mensaje y el número", async () => {
    servidor();
    render(<CobrosView />);

    const boton = await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por SMS` });
    // Lo que se lee en el botón, no solo su nombre accesible, dice el canal.
    expect(boton.textContent).toBe(RECORDAR_COBRO);
    expect(RECORDAR_COBRO).toMatch(/SMS/);
    fireEvent.click(boton);

    expect(await screen.findByText(RECORDAR_COBRO_TITULO)).toBeTruthy();
    expect(screen.getByText("+59899123456")).toBeTruthy();
    expect(smsPedidos()).toEqual([]);

    // Cancelar tampoco envía, y la fila vuelve a como estaba.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText(RECORDAR_COBRO_TITULO)).toBeNull());
    expect(smsPedidos()).toEqual([]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("recién con 'Enviar SMS' se pide el aviso, una sola vez", async () => {
    servidor();
    api.post.mockResolvedValue({ envioId: "e1", creado: true, programadoEn: "2026-09-20T12:00:00.000Z" });
    render(<CobrosView />);

    fireEvent.click(await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por SMS` }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: ENVIAR_SMS }));
    });

    expect(api.post.mock.calls).toEqual([["/api/pacientes/p1/recordar-cobro", {}]]);
    expect(await screen.findByText(/Aviso programado/)).toBeTruthy();
  });

  it("abrir Registrar pago cierra la confirmación del SMS: nunca quedan los dos a la vez", async () => {
    servidor();
    render(<CobrosView />);
    fireEvent.click(await screen.findByRole("button", { name: `Recordar cobro a ${LUCIA} por SMS` }));
    expect(await screen.findByRole("button", { name: ENVIAR_SMS })).toBeTruthy();
    // Con un panel abierto la fila no ofrece la otra acción.
    expect(screen.queryByRole("button", { name: `${REGISTRAR_PAGO} de ${LUCIA}` })).toBeNull();
  });
});

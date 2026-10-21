// @vitest-environment jsdom
//
// Lo que el forense de integración encontró en /grabar (revision/forense2,
// 1-camino-critico.md H1-H4), por lo que ve y toca la profesional. El
// grabador va doblado, como en grabar-view.test.tsx.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Grabador } from "@/components/grabacion/GrabadorSesion";
import {
  DESCARTAR_Y_GRABAR,
  DESCARTAR_Y_GRABAR_ACCION,
  DESCARTAR_Y_GRABAR_TITULO,
  ENVIAR_LA_QUE_QUEDO,
} from "@/lib/glosario";

import { GrabarView } from "../grabar-view";

const m = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  grabador: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPost: m.post,
}));
vi.mock("@/lib/grabacion-storage", () => ({ limpiarGrabacion: vi.fn(), asociarTurno: vi.fn(async () => {}) }));
vi.mock("@/lib/subida-audio", async (original) => ({
  ...(await original<typeof import("@/lib/subida-audio")>()),
  subirAudio: vi.fn(),
  volverAGrabando: vi.fn(),
  marcarTurnoRealizado: vi.fn(),
}));
vi.mock("@/components/grabacion/GrabadorSesion", () => ({
  formatearDuracion: () => "00:10",
  useGrabador: () => m.grabador,
}));

const props = { turnoId: "t1", turnoProgramado: true, horaTexto: "12:00", pacienteId: "p1", pacienteNombre: "Paciente Sintética", autorizacionVigente: true };

function grabadorEn(parcial: Partial<Grabador>) {
  m.grabador = {
    estado: "inactivo", segundos: 10, nivelAudio: 0.4, audioSilencioso: false, microfonoSilenciado: false, hueco: null,
    limiteAlcanzado: false, avisoLimite: false, conmutando: false, mensajeError: null, pendienteSeg: null, pendiente: null,
    muyCorta: false, copiaFallida: false,
    iniciar: vi.fn(async () => {}), pausar: vi.fn(), reanudar: vi.fn(), terminar: vi.fn(), descartar: vi.fn(), cerrarAvisoHueco: vi.fn(),
    enviarPendiente: vi.fn(), descartarPendiente: vi.fn(), anotar: vi.fn(), resetear: vi.fn(),
    ...parcial,
  };
  return m.grabador as unknown as Grabador;
}

/** 25 minutos que quedaron en el teléfono. */
function pendienteDe(clave: string, turnoId: string | null = null): Partial<Grabador> {
  return { pendienteSeg: 25 * 60, pendiente: { clave, iniciadaEn: Date.now() - 3_600_000, turnoId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.get.mockResolvedValue({ id: "s1", estado: "grabando" });
  grabadorEn({});
});
afterEach(cleanup);

describe("H2: una copia pendiente del mismo turno no se borra sin preguntar", () => {
  test("no hay un Grabar que la pise: se elige enviarla o descartarla y grabar de nuevo", () => {
    grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} />);
    expect(screen.getByText("Quedó una grabación de ~25 min sin enviar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
    expect(screen.getByRole("button", { name: ENVIAR_LA_QUE_QUEDO })).toBeTruthy();
    expect(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR })).toBeTruthy();
  });

  test("Enviar la que quedó la envía", async () => {
    const grabador = grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: ENVIAR_LA_QUE_QUEDO }));
    await waitFor(() => expect(grabador.enviarPendiente).toHaveBeenCalledOnce());
    expect(grabador.iniciar).not.toHaveBeenCalled();
  });

  test("Descartar y grabar de nuevo pide confirmación; con Cancelar no se toca nada", () => {
    const grabador = grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR }));
    expect(screen.getByText(DESCARTAR_Y_GRABAR_TITULO)).toBeTruthy();
    expect(grabador.iniciar).not.toHaveBeenCalled();
    expect(grabador.descartarPendiente).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(DESCARTAR_Y_GRABAR_TITULO)).toBeNull();
    expect(grabador.iniciar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: ENVIAR_LA_QUE_QUEDO })).toBeTruthy();
  });

  test("al confirmar, recién ahí graba de nuevo con la clave del turno", async () => {
    const grabador = grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR }));
    fireEvent.click(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR_ACCION }));
    await waitFor(() => expect(grabador.iniciar).toHaveBeenCalledWith("t1"));
  });

  test("una sin turno que ya quedó asociada a este turno también pregunta, y se borra con SU clave", async () => {
    const grabador = grabadorEn(pendienteDe("sin-turno:p1:2026-10-20T13:00:00.000Z", "t1"));
    render(<GrabarView {...props} />);
    expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR }));
    fireEvent.click(screen.getByRole("button", { name: DESCARTAR_Y_GRABAR_ACCION }));
    await waitFor(() => expect(grabador.iniciar).toHaveBeenCalledWith("t1"));
    expect(grabador.descartarPendiente).toHaveBeenCalledOnce();
  });

  test("la de otro turno no se pisa al grabar: Grabar sigue a mano", async () => {
    const grabador = grabadorEn(pendienteDe("t-ayer"));
    render(<GrabarView {...props} />);
    expect(screen.getByRole("button", { name: "Guardarla ahora" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
    await waitFor(() => expect(grabador.iniciar).toHaveBeenCalledWith("t1"));
  });
});

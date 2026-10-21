// @vitest-environment jsdom
//
// Lo que el forense de integración encontró en /grabar (revision/forense2,
// 1-camino-critico.md H1-H4), por lo que ve y toca la profesional. El
// grabador va doblado, como en grabar-view.test.tsx.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DatosGrabacion, Grabador } from "@/components/grabacion/GrabadorSesion";
import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import {
  COPIA_NO_GUARDADA,
  CORTE_LIMITE_SIN_COPIA,
  DESCARTAR_Y_GRABAR,
  DESCARTAR_Y_GRABAR_ACCION,
  DESCARTAR_Y_GRABAR_TITULO,
  ENVIAR_LA_QUE_QUEDO,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABAR_SALIDA_GRABANDO,
  GRABAR_SALIDA_SIN_COPIA,
  IR_IGUAL,
  PENDIENTE_SIN_AUTORIZACION,
  REINTENTAR,
  SALIDA_TRABAJO_TITULO,
  VOLVER,
  VOLVER_A_LA_FICHA,
} from "@/lib/glosario";
import { ApiClientError } from "@/lib/api-client";

import { GrabarView } from "../grabar-view";

const m = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  subir: vi.fn(),
  grabador: {} as Record<string, unknown>,
  opciones: null as null | { onListo: (d: DatosGrabacion) => void },
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
  subirAudio: m.subir,
  volverAGrabando: vi.fn(),
  marcarTurnoRealizado: vi.fn(),
}));
vi.mock("@/components/grabacion/GrabadorSesion", () => ({
  formatearDuracion: () => "00:10",
  useGrabador: (opciones: { onListo: (d: DatosGrabacion) => void }) => {
    m.opciones = opciones;
    return m.grabador;
  },
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

describe("H3: si la copia en el teléfono falla mientras graba, se dice ahí mismo", () => {
  test.each(["grabando", "pausado"] as const)("%s: queda un aviso fijo, sin botón para cerrarlo", (estado) => {
    grabadorEn({ estado, copiaFallida: true });
    render(<GrabarView {...props} />);
    const aviso = screen.getByText(COPIA_NO_GUARDADA);
    expect(aviso.closest('[role="status"]')).toBeTruthy();
    expect(aviso.parentElement?.querySelector("button")).toBeNull();
  });

  test("con la copia en orden no dice nada", () => {
    grabadorEn({ estado: "grabando", copiaFallida: false });
    render(<GrabarView {...props} />);
    expect(screen.queryByText(COPIA_NO_GUARDADA)).toBeNull();
  });

  test("en el tope lo dice una sola vez: el aviso del tope ya cuenta que no hay copia", () => {
    grabadorEn({ estado: "pausado", copiaFallida: true, limiteAlcanzado: true });
    render(<GrabarView {...props} />);
    expect(screen.getByText(CORTE_LIMITE_SIN_COPIA)).toBeTruthy();
    expect(screen.queryByText(COPIA_NO_GUARDADA)).toBeNull();
  });
});

describe("H4: no se sale de /grabar con audio que sólo está en memoria", () => {
  /** La pantalla dentro del dashboard, con el menú de abajo como un enlace. */
  function enElDashboard(extra: Partial<typeof props> = {}) {
    return render(
      <ProteccionTrabajo>
        <GrabarView {...props} {...extra} />
        <a href="/hoy">Hoy</a>
      </ProteccionTrabajo>,
    );
  }
  const salidaPedida = () => screen.queryByText(SALIDA_TRABAJO_TITULO);
  function cierreDePestanaFrenado() {
    const evento = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
  }

  /** Terminó y la subida falló por red: la pantalla de Reintentar. */
  async function subidaFallida(copiaEnTelefono: boolean) {
    m.subir.mockRejectedValue(new TypeError("Failed to fetch"));
    grabadorEn({ estado: "entregada", copiaFallida: !copiaEnTelefono });
    const vista = enElDashboard();
    const datos: DatosGrabacion = {
      audioBlob: new Blob(["audio"]), duracionSegundos: 600, pausas: [],
      diagnostico: { eventos: [], chunks: 600, bytes: 5 }, respaldoEnTelefono: async () => copiaEnTelefono,
    };
    await act(async () => { m.opciones?.onListo(datos); });
    await screen.findByRole("button", { name: REINTENTAR });
    return vista;
  }

  test("antes de grabar se puede volver, y el menú no pregunta", () => {
    enElDashboard();
    expect(screen.getByRole("link", { name: VOLVER })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(salidaPedida()).toBeNull();
    expect(cierreDePestanaFrenado()).toBe(false);
  });

  test("grabando no está Volver; el menú y cerrar la pestaña preguntan", () => {
    grabadorEn({ estado: "grabando" });
    enElDashboard();
    expect(screen.queryByRole("link", { name: VOLVER })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(salidaPedida()).toBeTruthy();
    expect(screen.getByText(GRABAR_SALIDA_GRABANDO)).toBeTruthy();
    expect(m.router.push).not.toHaveBeenCalled();
    expect(cierreDePestanaFrenado()).toBe(true);
  });

  test("grabando sin copia en el teléfono, avisa que se pierde", () => {
    grabadorEn({ estado: "pausado", copiaFallida: true });
    enElDashboard();
    fireEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(screen.getAllByText(GRABAR_SALIDA_SIN_COPIA).length).toBeGreaterThan(0);
  });

  test("subida fallida sin copia: no está Volver, el menú pregunta y, si ella insiste, se va", async () => {
    await subidaFallida(false);
    expect(screen.queryByRole("link", { name: VOLVER })).toBeNull();
    expect(cierreDePestanaFrenado()).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(screen.getAllByText(GRABAR_SALIDA_SIN_COPIA).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
    expect(m.router.push).toHaveBeenCalledWith("/hoy");
  });

  test("subida fallida con la copia en el teléfono: Volver tampoco está, pero salir no pierde nada", async () => {
    await subidaFallida(true);
    expect(screen.queryByRole("link", { name: VOLVER })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(salidaPedida()).toBeNull();
  });

  test("un rechazo sin copia: Volver a la ficha también pregunta", async () => {
    m.subir.mockRejectedValue(new ApiClientError("La grabación no se puede guardar", 422));
    m.get.mockResolvedValue({ id: "s1", estado: "fallida" });
    grabadorEn({ estado: "entregada", copiaFallida: true });
    enElDashboard();
    const datos: DatosGrabacion = {
      audioBlob: new Blob(["audio"]), duracionSegundos: 600, pausas: [],
      diagnostico: { eventos: [], chunks: 600, bytes: 5 }, respaldoEnTelefono: async () => false,
    };
    await act(async () => { m.opciones?.onListo(datos); });
    fireEvent.click(await screen.findByRole("button", { name: VOLVER_A_LA_FICHA }));
    expect(salidaPedida()).toBeTruthy();
    expect(m.router.push).not.toHaveBeenCalled();
  });
});

describe("H1: una grabación a medias sin autorización vigente se retoma, y la firma se pide antes de subir", () => {
  test("la copia se muestra, con la firma como paso antes de enviarla", () => {
    grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} autorizacionVigente={false} />);
    expect(screen.getByText("Quedó una grabación de ~25 min sin enviar")).toBeTruthy();
    expect(screen.getByText(PENDIENTE_SIN_AUTORIZACION)).toBeTruthy();
    expect(screen.getByText(FALTA_AUTORIZACION)).toBeTruthy();
    const firmar = screen.getAllByRole("link", { name: FIRMAR_AUTORIZACION });
    expect(firmar).toHaveLength(1);
    expect(firmar[0].getAttribute("href")).toBe("/pacientes/p1");
    // Sin firma no se envía ni se graba.
    expect(screen.queryByRole("button", { name: "Guardarla ahora" })).toBeNull();
    expect(screen.queryByRole("button", { name: ENVIAR_LA_QUE_QUEDO })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  });

  test("también la de un turno de ayer, que ya no se puede grabar de nuevo", () => {
    grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} autorizacionVigente={false} motivoSinGrabar="Este turno era de ayer." />);
    expect(screen.getByText(PENDIENTE_SIN_AUTORIZACION)).toBeTruthy();
    expect(screen.getByRole("link", { name: FIRMAR_AUTORIZACION })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guardarla ahora" })).toBeNull();
  });

  test("se puede descartar igual", () => {
    const grabador = grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} autorizacionVigente={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Descartarla" }));
    expect(grabador.descartarPendiente).toHaveBeenCalledOnce();
    expect(grabador.enviarPendiente).not.toHaveBeenCalled();
  });

  test("ya firmada, la misma copia se envía como siempre", async () => {
    const grabador = grabadorEn(pendienteDe("t1"));
    render(<GrabarView {...props} autorizacionVigente />);
    fireEvent.click(screen.getByRole("button", { name: ENVIAR_LA_QUE_QUEDO }));
    await waitFor(() => expect(grabador.enviarPendiente).toHaveBeenCalledOnce());
  });

  test("sin copia en el teléfono, sigue siendo sólo Falta la autorización", () => {
    grabadorEn({});
    render(<GrabarView {...props} autorizacionVigente={false} />);
    expect(screen.getByText(FALTA_AUTORIZACION)).toBeTruthy();
    expect(screen.getByRole("link", { name: FIRMAR_AUTORIZACION })).toBeTruthy();
    expect(screen.queryByText(PENDIENTE_SIN_AUTORIZACION)).toBeNull();
  });
});

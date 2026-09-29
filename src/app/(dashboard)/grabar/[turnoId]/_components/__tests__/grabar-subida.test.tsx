// @vitest-environment jsdom
//
// Grabar: qué pasa cuando la subida falla. Un fallo que se arregla solo
// (red, R2) se reintenta con la misma grabación; un rechazo del servidor que
// reintentar no arregla (409, 422) termina con "Volver a la ficha", sin un
// Reintentar que fallaría cada vez. Y un turno que no se puede grabar no
// muestra el botón.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatosGrabacion, EstadoGrabador, Grabador } from "@/components/grabacion/GrabadorSesion";
import { ErrorSubida } from "@/hooks/useGrabacionSesion";
import {
  AUDIO_NO_GUARDADO,
  GRABACION_LLEGO,
  GRABAR_SESION,
  REINTENTAR,
  TURNO_SIN_SESION_PARA_GRABAR,
  VOLVER_A_LA_FICHA,
} from "@/lib/glosario";

import { GrabarView, pantallaDe } from "../grabar-view";
import { motivoSinGrabar } from "../motivo-sin-grabar";

const m = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  get: vi.fn(),
  subir: vi.fn(),
  volverAGrabando: vi.fn(),
  grabador: {} as Record<string, unknown>,
  opciones: null as null | { onListo: (d: unknown) => void },
}));

vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPost: vi.fn(),
}));
vi.mock("@/lib/grabacion-storage", () => ({ limpiarGrabacion: vi.fn() }));
vi.mock("@/hooks/useGrabacionSesion", async (original) => ({
  ...(await original<typeof import("@/hooks/useGrabacionSesion")>()),
  subirAudio: m.subir,
  volverAGrabando: m.volverAGrabando,
  marcarTurnoRealizado: vi.fn(),
}));
vi.mock("@/components/grabacion/GrabadorSesion", () => ({
  formatearDuracion: () => "00:10",
  useGrabador: (opciones: { onListo: (d: unknown) => void }) => {
    m.opciones = opciones;
    return m.grabador;
  },
}));
// La autorización de grabar trae su propio fetch; acá no interesa.
vi.mock("@/app/api/_lib/casos-uso/audio", () => ({
  MENSAJE_GRABAR_OTRO_DIA: "Solo se puede grabar un turno el mismo día.",
}));

const DATOS: DatosGrabacion = { audioBlob: new Blob(["audio"]), duracionSegundos: 600, pausas: [], diagnostico: { eventos: [], chunks: 600, bytes: 5 } };
const props = { turnoId: "t1", turnoProgramado: false, horaTexto: "12:00", pacienteId: "p1", pacienteNombre: "Paciente Sintética", autorizacionVigente: true };

function grabadorEn(parcial: Partial<Grabador>) {
  m.grabador = {
    estado: "inactivo", segundos: 10, nivelAudio: 0.4, audioSilencioso: false, microfonoSilenciado: false, hueco: null,
    limiteAlcanzado: false, avisoLimite: false, conmutando: false, mensajeError: null, pendienteSeg: null, muyCorta: false,
    iniciar: vi.fn(), pausar: vi.fn(), reanudar: vi.fn(), terminar: vi.fn(), descartar: vi.fn(), cerrarAvisoHueco: vi.fn(),
    enviarPendiente: vi.fn(), descartarPendiente: vi.fn(), anotar: vi.fn(), resetear: vi.fn(),
    ...parcial,
  };
}

/** La subida falla y, en el mismo momento, la sesión queda en `estado` del
 *  lado del servidor (es lo que la pantalla relee para decidir). */
function rechazarLaSubida(error: ErrorSubida, estado: string) {
  m.subir.mockImplementationOnce(async () => {
    m.get.mockResolvedValue({ id: "s1", estado });
    throw error;
  });
}

/** Deja la sesión anotada (por el camino de la copia pendiente) y entrega la grabación. */
async function subirUnaGrabacion() {
  grabadorEn({ estado: "inactivo", pendienteSeg: 600 });
  const { rerender } = render(<GrabarView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Guardarla ahora" }));
  await waitFor(() => expect(m.grabador.enviarPendiente).toHaveBeenCalled());
  grabadorEn({ estado: "entregada" });
  rerender(<GrabarView {...props} />);
  await act(async () => {
    m.opciones?.onListo(DATOS);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.get.mockResolvedValue({ id: "s1", estado: "grabando" });
});
afterEach(() => cleanup());

describe("cuando la subida falla", () => {
  it("un fallo de red dice AUDIO_NO_GUARDADO y Reintentar vuelve a subir la misma grabación", async () => {
    m.subir
      .mockRejectedValueOnce(new ErrorSubida("Fallo de red al subir el audio.", "put"))
      .mockResolvedValueOnce(undefined);
    await subirUnaGrabacion();

    expect(await screen.findByText(AUDIO_NO_GUARDADO)).toBeTruthy();
    expect(m.volverAGrabando).toHaveBeenCalledWith("s1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: REINTENTAR }));
    });
    expect(m.subir).toHaveBeenCalledTimes(2);
    expect(m.subir.mock.calls[1][1]).toBe(DATOS);
    expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
  });

  it("un 4xx de R2 en el PUT también se reintenta: pedir otra URL lo arregla", async () => {
    m.subir.mockRejectedValueOnce(new ErrorSubida("R2 rechazó la subida (HTTP 403).", "put", 403));
    await subirUnaGrabacion();
    expect(await screen.findByText(AUDIO_NO_GUARDADO)).toBeTruthy();
    expect(screen.getByRole("button", { name: REINTENTAR })).toBeTruthy();
  });

  it.each([
    ["url", 409, "La grabación ya se cerró. Revisá su estado.", "fallida"],
    ["confirmar", 422, "La grabación es muy corta para escribir una nota.", "fallida"],
    ["url", 409, "Esta sesión ya se está procesando.", "procesando"],
  ] as const)("un %s con %i (%s), con la sesión en %s, no ofrece Reintentar: dice lo que contestó el servidor y vuelve a la ficha", async (paso, status, texto, estado) => {
    rechazarLaSubida(new ErrorSubida(texto, paso, status), estado);
    await subirUnaGrabacion();

    expect((await screen.findByRole("alert")).textContent).toBe(texto);
    expect(screen.queryByRole("button", { name: REINTENTAR })).toBeNull();
    expect(m.volverAGrabando).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: VOLVER_A_LA_FICHA }));
    expect(m.router.push).toHaveBeenCalledWith("/pacientes/p1");
  });

  it.each([
    ["el confirmar dijo que no llegó y dejó la sesión en grabando", "confirmar", "grabando"],
    ["el upload-url encontró la sesión en subiendo", "url", "subiendo"],
  ] as const)("un 409 cuando %s se reintenta", async (_caso, paso, estado) => {
    rechazarLaSubida(new ErrorSubida("No llegó.", paso, 409), estado);
    await subirUnaGrabacion();

    expect(await screen.findByText(AUDIO_NO_GUARDADO)).toBeTruthy();
    expect(screen.getByRole("button", { name: REINTENTAR })).toBeTruthy();
    expect(m.volverAGrabando).toHaveBeenCalledWith("s1");
  });

  it("si no se puede leer la sesión después de un 409, se reintenta como siempre", async () => {
    m.subir.mockImplementationOnce(async () => {
      m.get.mockRejectedValue(new Error("sin red"));
      throw new ErrorSubida("No llegó.", "confirmar", 409);
    });
    await subirUnaGrabacion();
    expect(await screen.findByText(AUDIO_NO_GUARDADO)).toBeTruthy();
  });
});

describe("un turno que no se puede grabar", () => {
  it("no muestra Grabar sesión: dice por qué y lleva a la ficha", () => {
    grabadorEn({});
    render(<GrabarView {...props} motivoSinGrabar={TURNO_SIN_SESION_PARA_GRABAR} />);
    expect(screen.getByText(TURNO_SIN_SESION_PARA_GRABAR)).toBeTruthy();
    expect(screen.queryByRole("button", { name: GRABAR_SESION })).toBeNull();
    expect(screen.getByRole("link", { name: VOLVER_A_LA_FICHA }).getAttribute("href")).toBe("/pacientes/p1");
  });

  const HOY = new Date("2026-09-11T15:00:00Z");
  const AYER = new Date("2026-09-10T15:00:00Z");

  it.each([
    ["de hoy, programado", { estado: "programado", fecha: HOY, sesionClinica: null }, null],
    ["de ayer", { estado: "programado", fecha: AYER, sesionClinica: null }, "Solo se puede grabar un turno el mismo día."],
    ["de ayer con la grabación a medias", { estado: "programado", fecha: AYER, sesionClinica: { estado: "grabando" } }, null],
    ["de ayer con la subida a medias", { estado: "realizado", fecha: AYER, sesionClinica: { estado: "subiendo" } }, null],
    ["cancelado", { estado: "cancelado", fecha: HOY, sesionClinica: null }, TURNO_SIN_SESION_PARA_GRABAR],
    ["ausente", { estado: "ausente", fecha: HOY, sesionClinica: null }, TURNO_SIN_SESION_PARA_GRABAR],
  ])("motivoSinGrabar: turno %s", (_nombre, turno, esperado) => {
    expect(motivoSinGrabar(turno, HOY)).toBe(esperado);
  });
});

describe("pantallaDe", () => {
  it.each<[Parameters<typeof pantallaDe>[0], EstadoGrabador, ReturnType<typeof pantallaDe>]>([
    ["previo", "preparando", "enviando"],
    ["enviando", "entregada", "enviando"],
    ["guardado", "entregada", "llego"],
    ["no-guardado", "terminada", "reintentar-subida"],
    ["turno-sin-marcar", "entregada", "reintentar-turno"],
    ["rechazada", "terminada", "rechazada"],
    ["previo", "grabando", "grabando"],
    ["previo", "pausado", "grabando"],
    ["previo", "terminada", "grabando"],
    ["previo", "error", "error-mic"],
    ["previo", "inactivo", "previa"],
    ["preparando", "inactivo", "previa"],
  ])("fase %s con el grabador en %s → %s", (fase, grabador, pantalla) => {
    expect(pantallaDe(fase, grabador)).toBe(pantalla);
  });
});

// @vitest-environment jsdom
//
// La pantalla de grabar, por lo que ve y toca la profesional. El grabador va
// doblado (sus pruebas están en grabador-interrupciones.test.tsx); el wake
// lock es el hook de verdad contra un navigator.wakeLock falso.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DatosGrabacion, Grabador } from "@/components/grabacion/GrabadorSesion";
import {
  AVISO_HUECO,
  AVISO_PANTALLA_APAGADA,
  AVISO_SIN_AUDIO_DESDE,
  AVISO_SIN_PANTALLA_ENCENDIDA,
  ENTENDIDO,
  ENVIANDO_GRABACION,
  GRABACION_LLEGO,
  GRABACION_TERMINO_MICROFONO,
  GUARDAR_LO_GRABADO,
  PREPARANDO_GRABACION,
  REANUDAR,
  SEGUIR_GRABANDO,
  VOLVER_A_LA_FICHA,
} from "@/lib/glosario";

import { GrabarView } from "../grabar-view";

const m = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  subir: vi.fn(),
  limpiar: vi.fn(),
  grabador: {} as Record<string, unknown>,
  opciones: null as null | { onListo: (d: unknown) => void },
}));

vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/api-client", () => ({ apiGet: m.get, apiPost: m.post }));
vi.mock("@/lib/grabacion-storage", () => ({ limpiarGrabacion: m.limpiar }));
vi.mock("@/hooks/useGrabacionSesion", () => ({ subirAudio: m.subir, volverAGrabando: vi.fn(), marcarTurnoRealizado: vi.fn() }));
vi.mock("@/components/grabacion/GrabadorSesion", () => ({
  formatearDuracion: () => "00:10",
  useGrabador: (opciones: { onListo: (d: unknown) => void }) => {
    m.opciones = opciones;
    return m.grabador;
  },
}));

const DATOS: DatosGrabacion = { audioBlob: new Blob(["audio"]), duracionSegundos: 10, pausas: [], diagnostico: { eventos: [], chunks: 10, bytes: 5 } };
const props = { turnoId: "t1", turnoProgramado: false, horaTexto: "12:00", pacienteId: "p1", pacienteNombre: "Paciente Sintética", autorizacionVigente: true };

function grabadorEn(parcial: Partial<Grabador>) {
  m.grabador = {
    estado: "inactivo", segundos: 10, nivelAudio: 0.4, audioSilencioso: false, microfonoSilenciado: false, hueco: null,
    limiteAlcanzado: false, avisoLimite: false, conmutando: false, mensajeError: null, pendienteSeg: null, muyCorta: false,
    iniciar: vi.fn(), pausar: vi.fn(), reanudar: vi.fn(), terminar: vi.fn(), descartar: vi.fn(), cerrarAvisoHueco: vi.fn(),
    enviarPendiente: vi.fn(), descartarPendiente: vi.fn(), anotar: vi.fn(), resetear: vi.fn(),
    ...parcial,
  };
  return m.grabador as unknown as Grabador;
}

/** Un wake lock que el "sistema" puede soltar. */
function wakeLockQue(resultado: "concede" | "rechaza") {
  const locks: EventTarget[] = [];
  const request = vi.fn(async () => {
    if (resultado === "rechaza") throw new DOMException("ahorro de batería", "NotAllowedError");
    const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    locks.push(lock);
    return lock;
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { request, soltar: () => locks.at(-1)?.dispatchEvent(new Event("release")) };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.get.mockResolvedValue({ id: "s1", estado: "grabando" });
  m.subir.mockResolvedValue(undefined);
  grabadorEn({});
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
});

test("antes de empezar avisa si el teléfono no concedió mantener la pantalla encendida", async () => {
  wakeLockQue("rechaza");
  render(<GrabarView {...props} />);
  expect(await screen.findByText(AVISO_SIN_PANTALLA_ENCENDIDA)).toBeTruthy();
  // Es un aviso: igual se puede grabar.
  expect((screen.getByRole("button", { name: "Grabar sesión" }) as HTMLButtonElement).disabled).toBe(false);
});

test("con la pantalla encendida concedida no dice nada", async () => {
  const { request } = wakeLockQue("concede");
  render(<GrabarView {...props} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
  expect(screen.queryByText(AVISO_SIN_PANTALLA_ENCENDIDA)).toBeNull();
});

test("si la pantalla se apaga grabando, el aviso queda hasta que ella lo cierra", async () => {
  const wake = wakeLockQue("concede");
  const grabador = grabadorEn({ estado: "grabando" });
  render(<GrabarView {...props} />);
  await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(1));

  act(() => { wake.soltar(); });
  expect(screen.getByText(AVISO_PANTALLA_APAGADA)).toBeTruthy();
  expect(grabador.anotar).toHaveBeenCalledWith("wakelock-soltado");

  // Vuelve a la app: se vuelve a pedir la pantalla encendida y el aviso SIGUE.
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
  expect(screen.getByText(AVISO_PANTALLA_APAGADA)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: ENTENDIDO }));
  expect(screen.queryByText(AVISO_PANTALLA_APAGADA)).toBeNull();
});

test("un hueco sin audio se dice con sus horas y deja seguir o terminar", () => {
  const desde = new Date("2026-09-18T10:12:00").getTime();
  const hasta = new Date("2026-09-18T10:20:00").getTime();
  const grabador = grabadorEn({ estado: "grabando", hueco: { desde, hasta } });
  render(<GrabarView {...props} />);

  expect(AVISO_HUECO(desde, hasta)).toContain("No se grabó entre las 10:12 y las 10:20");
  expect(screen.getByText(AVISO_HUECO(desde, hasta))).toBeTruthy();
  expect(screen.getByRole("button", { name: "Terminar la sesión" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: SEGUIR_GRABANDO }));
  expect(grabador.cerrarAvisoHueco).toHaveBeenCalledOnce();
});

test("mientras el audio todavía no volvió, lo dice desde cuándo", () => {
  const desde = new Date("2026-09-18T10:12:00").getTime();
  grabadorEn({ estado: "grabando", hueco: { desde, hasta: null } });
  render(<GrabarView {...props} />);
  expect(screen.getByText(AVISO_SIN_AUDIO_DESDE(desde))).toBeTruthy();
});

test("Reanudar va deshabilitado mientras corre: un doble toque no lo ejecuta dos veces", () => {
  const grabador = grabadorEn({ estado: "pausado", conmutando: true });
  render(<GrabarView {...props} />);
  const boton = screen.getByRole("button", { name: REANUDAR }) as HTMLButtonElement;
  expect(boton.disabled).toBe(true);
  fireEvent.click(boton);
  expect(grabador.reanudar).not.toHaveBeenCalled();
});

test("si el micrófono se desconectó, sólo se ofrece guardar lo grabado, en palabras claras", () => {
  const grabador = grabadorEn({ estado: "terminada" });
  render(<GrabarView {...props} />);
  expect(screen.getByRole("alert").textContent).toBe(GRABACION_TERMINO_MICROFONO);
  expect(screen.queryByRole("button", { name: REANUDAR })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pausar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: GUARDAR_LO_GRABADO }));
  expect(grabador.terminar).toHaveBeenCalledOnce();
});

test("en el tope no se reanuda: se termina", () => {
  grabadorEn({ estado: "pausado", limiteAlcanzado: true });
  render(<GrabarView {...props} />);
  expect(screen.queryByRole("button", { name: REANUDAR })).toBeNull();
  expect(screen.getByRole("button", { name: "Terminar la sesión" })).toBeTruthy();
});

test("tras Terminar: preparando, enviando con porcentaje y menú tapado, llegó bien; y NO navega sola", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let progresar: (p: number) => void = () => {};
  let terminarSubida: () => void = () => {};
  m.subir.mockImplementation((_s: string, _d: unknown, onProgreso: (p: number) => void) => {
    progresar = onProgreso;
    return new Promise<void>((resolve) => { terminarSubida = resolve; });
  });

  grabadorEn({ estado: "preparando" });
  const { rerender } = render(<GrabarView {...props} />);
  expect(screen.getByRole("status").textContent).toBe(PREPARANDO_GRABACION);

  // Empezar dejó la sesión anotada; acá se simula con el camino de la pendiente.
  grabadorEn({ estado: "inactivo", pendienteSeg: 60 });
  rerender(<GrabarView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Guardarla ahora" }));
  await waitFor(() => expect(m.grabador.enviarPendiente).toHaveBeenCalled());

  grabadorEn({ estado: "entregada" });
  rerender(<GrabarView {...props} />);
  await act(async () => { m.opciones?.onListo(DATOS); });
  act(() => progresar(37));

  expect(screen.getByRole("status").textContent).toBe(ENVIANDO_GRABACION(37));
  expect(ENVIANDO_GRABACION(37)).toBe("Enviando la grabación… 37 %. No cierres esta pantalla.");
  // Tapa toda la pantalla por encima del menú inferior (z-50) y algo se mueve.
  const tapa = screen.getByTestId("enviando");
  expect(tapa.className).toContain("fixed inset-0");
  expect(tapa.className).toContain("z-[60]");
  expect(tapa.querySelector(".animate-spin")).toBeTruthy();
  expect(m.subir).toHaveBeenCalledWith("s1", DATOS, expect.any(Function));

  await act(async () => { terminarSubida(); });
  expect(await screen.findByText(GRABACION_LLEGO)).toBeTruthy();
  expect(screen.queryByTestId("enviando")).toBeNull();
  expect(m.limpiar).toHaveBeenCalledWith("t1");

  // Pasa un buen rato y la pantalla sigue ahí: se va cuando ella toca.
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(m.router.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: VOLVER_A_LA_FICHA }));
  expect(m.router.push).toHaveBeenCalledWith("/pacientes/p1");
  vi.useRealTimers();
});

test("la pantalla se mantiene encendida también mientras sube, y se suelta cuando llegó", async () => {
  const wake = wakeLockQue("concede");
  let terminarSubida: () => void = () => {};
  m.subir.mockImplementation(() => new Promise<void>((resolve) => { terminarSubida = resolve; }));
  grabadorEn({ estado: "inactivo", pendienteSeg: 60 });
  const { rerender } = render(<GrabarView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Guardarla ahora" }));
  await waitFor(() => expect(m.grabador.enviarPendiente).toHaveBeenCalled());
  grabadorEn({ estado: "entregada" });
  rerender(<GrabarView {...props} />);
  await act(async () => { m.opciones?.onListo(DATOS); });

  // Enviando: el lock sigue tomado, y si el sistema lo suelta se avisa.
  const lock = await wake.request.mock.results[0].value;
  expect(lock.release).not.toHaveBeenCalled();
  act(() => { wake.soltar(); });
  expect(screen.getByText(AVISO_PANTALLA_APAGADA)).toBeTruthy();

  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
  const segundo = await wake.request.mock.results[1].value;
  await act(async () => { terminarSubida(); });
  await screen.findByText(GRABACION_LLEGO);
  expect(segundo.release).toHaveBeenCalled();
});

test("una copia local de una sesión que ya está en procesando se borra en vez de ofrecerse", async () => {
  m.get.mockResolvedValue({ id: "s1", estado: "procesando" });
  const grabador = grabadorEn({ pendienteSeg: 600 });
  render(<GrabarView {...props} />);
  await waitFor(() => expect(grabador.descartarPendiente).toHaveBeenCalledOnce());
});

test("una copia local de una sesión todavía en grabando se ofrece, sin pedir ninguna clave", async () => {
  const grabador = grabadorEn({ pendienteSeg: 600 });
  render(<GrabarView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Guardarla ahora" }));
  await waitFor(() => expect(grabador.enviarPendiente).toHaveBeenCalledWith());
  expect(grabador.descartarPendiente).not.toHaveBeenCalled();
  expect(m.get.mock.calls.every(([url]) => !String(url).includes("/clave"))).toBe(true);
  expect(m.post).not.toHaveBeenCalled();
});

test("el turno que nace al grabar se crea con alGrabar: no pasa por la regla de choque", async () => {
  m.post.mockImplementation(async (url: string) =>
    url === "/api/turnos" ? { id: "t-nuevo", fecha: "2026-09-18T15:00:00.000Z" } : { id: "s1", estado: "grabando" });
  m.get.mockResolvedValue(null);
  const grabador = grabadorEn({});
  render(<GrabarView {...props} turnoId={null} />);

  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));

  await waitFor(() => expect(grabador.iniciar).toHaveBeenCalledWith("t-nuevo"));
  expect(m.post).toHaveBeenCalledWith("/api/turnos", expect.objectContaining({ pacienteId: "p1", alGrabar: true }));
  // Con un turno que ya existía no se crea ninguno.
  expect(m.post.mock.calls.filter(([url]) => url === "/api/turnos")).toHaveLength(1);
});

test("con un turno ya agendado no se crea otro ni se manda alGrabar", async () => {
  const grabador = grabadorEn({});
  render(<GrabarView {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  await waitFor(() => expect(grabador.iniciar).toHaveBeenCalledWith("t1"));
  expect(m.post.mock.calls.some(([url]) => url === "/api/turnos")).toBe(false);
});

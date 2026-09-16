// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// Salir de una nota en revisión con correcciones sin aprobar.
//
// El texto editado vive en el estado de la pantalla y sólo se escribe al
// aprobar: cualquier cosa que desmonte la pantalla lo borra. Acá se verifica
// la puerta del botón "Volver" —la del selector está en para-vos.test.tsx— y
// que el aviso del navegador se registre y se dé de baja con los cambios.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { apiGet, apiPost, ApiClientError } from "@/lib/api-client";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";
import {
  SALIDA_TRABAJO_TITULO,
  EDITAR,
  IR_IGUAL,
  QUEDARME,
  SOAP_S,
  VOLVER,
} from "@/lib/glosario";

import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { FALTA_REVISAR_MENCIONES, FALTA_REVISAR_RIESGO, APROBAR_DESCARTA_ANTERIOR } from "@/lib/glosario";
import { SesionDetailView } from "../sesion-detail-view";

vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
const back = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push: vi.fn(), replace: vi.fn() }),
}));

// La sesión llega por el cliente de API; el polling no corre porque el
// estado no está en ESTADOS_ACTIVOS, pero el hook se mockea igual para no
// depender de temporizadores.
vi.mock("@/hooks/useSesionClinicaPolling", () => ({
  ESTADOS_ACTIVOS: new Set(["grabando", "subiendo", "procesando"]),
  useSesionClinicaPolling: () => undefined,
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn(() => Promise.resolve(sesionEnRevision())),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  esAbort: () => false,
}));

const NOTA = {
  subjetivo: "Relató la semana.",
  objetivo: "Se la vio cansada.",
  analisis: "Sigue el mismo hilo.",
  plan: "Retomar el trabajo.",
};

function sesionEnRevision(): SesionClinicaResponse {
  // Sin señal de riesgo: aprobar no depende de ninguna casilla y la nota es
  // editable de entrada.
  return {
    id: "ses_1",
    turnoId: "t_1",
    estado: "revision",
    audioEstado: "borrado",
    audioBorradoEn: null,
    duracionAudioSeg: 3000,
    pausas: null,
    intento: 1,
    generacion: 1,
    falloCodigo: null,
    falloDetalle: null,
    transcripcionDisponible: true,
    notaIa: NOTA,
    notaFinal: null,
    notasEdicion: null,
    datos: {},
    feedbackEstado: "listo",
    feedback: null,
    feedbackError: null,
    modeloAsr: null,
    modeloLlm: null,
    promptVersion: null,
    procesadaEn: null,
    aprobadaEn: null,
    creadaEn: "2026-09-07T13:00:00.000Z",
    actualizadaEn: "2026-09-07T13:00:00.000Z",
    turno: {
      id: "t_1",
      fecha: "2026-09-07T13:00:00.000Z",
      paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" },
    },
  } as unknown as SesionClinicaResponse;
}

/** Monta la nota y espera a que llegue la fila. */
async function abrirLaNota() {
  render(<ProteccionTrabajo><SesionDetailView id="ses_1" /></ProteccionTrabajo>);
  await screen.findByRole("heading", { level: 1, name: "Lucía Fernández" });
}

/** Corrige la sección S, como lo haría ella: tocar Editar, escribir, salir
 *  del campo. El texto queda en el estado de la pantalla, sin aprobar. */
function corregirLaS(texto: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `${EDITAR} — ${SOAP_S.titulo}` }),
  );
  const campo = screen.getByRole("textbox");
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.blur(campo);
}

it("las menciones se leen en la nota y la aprobación envía confirmoMenciones", async () => {
  const fila = { ...sesionEnRevision(), datos: { riesgoLexico: { coincidencias: [{ termino: "morir", timestamp: "00:10", quote: "Dijo que quería morir" }] } } } as SesionClinicaResponse;
  vi.mocked(apiGet).mockResolvedValueOnce(fila);
  vi.mocked(apiPost).mockResolvedValueOnce({ ...fila, estado: "aprobada", notaFinal: NOTA });
  await abrirLaNota();
  expect((screen.getByRole("button", { name: /Aprobar/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Dijo que quería morir")).toBeTruthy();
  expect(screen.getByText(FALTA_REVISAR_MENCIONES)).toBeTruthy();
  expect(screen.queryByText(FALTA_REVISAR_RIESGO)).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Leí las menciones" }));
  fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Aprobar/ }));
  await waitFor(() => expect(vi.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ generacion: 1, confirmoMenciones: true }));
});

describe("Volver con correcciones sin aprobar", () => {
  beforeEach(() => back.mockClear());

  it("sin correcciones, Volver vuelve", async () => {
    await abrirLaNota();
    fireEvent.click(screen.getByRole("button", { name: VOLVER }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("con correcciones, Volver NO vuelve: pregunta", async () => {
    await abrirLaNota();
    corregirLaS("Relató la semana, con más detalle del trabajo.");

    fireEvent.click(screen.getByRole("button", { name: VOLVER }));

    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(SALIDA_TRABAJO_TITULO)).toBeTruthy();
  });

  it("'Quedarme' cierra la pregunta y la nota sigue en pantalla", async () => {
    await abrirLaNota();
    const corregido = "Relató la semana, con más detalle del trabajo.";
    corregirLaS(corregido);

    fireEvent.click(screen.getByRole("button", { name: VOLVER }));
    fireEvent.click(screen.getByRole("button", { name: QUEDARME }));

    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Y la corrección no se perdió por haber preguntado.
    expect(screen.getByText(corregido)).toBeTruthy();
  });

  it("'Ir igual' es lo único que vuelve con correcciones", async () => {
    await abrirLaNota();
    corregirLaS("Relató la semana, con más detalle del trabajo.");

    fireEvent.click(screen.getByRole("button", { name: VOLVER }));
    expect(back).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("deshacer la corrección a mano vuelve a dejar Volver directo", async () => {
    await abrirLaNota();
    corregirLaS("Otra cosa.");
    corregirLaS("Relató la semana.");

    fireEvent.click(screen.getByRole("button", { name: VOLVER }));

    // El borrador volvió a ser igual a la nota de la fila: no hay nada que
    // perder y no hay nada que preguntar.
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("cerrar la pestaña o recargar", () => {
  it("se avisa mientras hay correcciones, y se deja de avisar sin ellas", async () => {
    const intentaSalir = () => {
      const evento = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    };
    await abrirLaNota();
    expect(intentaSalir()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: `${EDITAR} — ${SOAP_S.titulo}` }));
    const campo = screen.getByRole("textbox");
    fireEvent.change(campo, { target: { value: "Todavía escribiendo, sin blur" } });
    expect(intentaSalir()).toBe(true);
    fireEvent.change(campo, { target: { value: NOTA.subjetivo } });
    expect(intentaSalir()).toBe(false);
  });
});

describe("aprobación de una generación obsoleta", () => {
  beforeEach(() => { vi.mocked(apiGet).mockReset().mockResolvedValue(sesionEnRevision()); vi.mocked(apiPost).mockReset(); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
  it("envía la generación vista y permite revisar la actual conservando el borrador", async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiClientError("La nota cambió. Revisá la nota actual.", 409));
    await abrirLaNota();
    corregirLaS("Mi corrección anterior");
    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Aprobar/ }));
    await screen.findByRole("button", { name: "Revisar nota actual" });
    expect(vi.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ generacion: 1, notaEditada: { subjetivo: "Mi corrección anterior" } });
    expect(screen.getByText("Mi corrección anterior")).toBeTruthy();
    vi.mocked(apiGet).mockResolvedValueOnce({ ...sesionEnRevision(), generacion: 2, notaIa: { ...NOTA, subjetivo: "Nota actual nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar nota actual" }));
    await screen.findByText("Nota actual nueva");
    expect(screen.getByText("Mi corrección anterior")).toBeTruthy();
    expect(screen.getByText("Tu borrador anterior")).toBeTruthy();
    vi.mocked(apiPost).mockResolvedValueOnce({ ...sesionEnRevision(), estado: "aprobada", generacion: 2 });
    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }));
    expect(screen.getByText(APROBAR_DESCARTA_ANTERIOR)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Aprobar/ }));
    await waitFor(() => expect(vi.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ generacion: 2, notaEditada: { subjetivo: "Nota actual nueva" } }));
    await waitFor(() => expect(screen.queryByText("Tu borrador anterior")).toBeNull());
    back.mockClear();
    fireEvent.click(screen.getByRole("button", { name: VOLVER }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

it("las confirmaciones de riesgo de una generación no habilitan la siguiente", async () => {
  const fila = { ...sesionEnRevision(), datos: { riesgoDetectado: { nivel: "moderado", indicadores: [], evidencia: [], notaParaTerapeuta: null } } } as SesionClinicaResponse;
  vi.mocked(apiGet).mockReset().mockResolvedValue(fila);
  vi.mocked(apiPost).mockReset().mockRejectedValueOnce(new ApiClientError("Revisá la nota actual", 409));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  await abrirLaNota();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Aprobar/ }));
  await screen.findByRole("button", { name: "Revisar nota actual" });
  expect(vi.mocked(apiPost).mock.calls[0][1]).toMatchObject({ generacion: 1, confirmoRiesgo: true });
  vi.mocked(apiGet).mockResolvedValueOnce({ ...fila, generacion: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Revisar nota actual" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Revisar nota actual" })).toBeNull());
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button", { name: /Aprobar/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("si otra pestaña aprobó la misma generación, muestra la nota realmente aprobada", async () => {
  vi.mocked(apiGet).mockReset().mockResolvedValue(sesionEnRevision());
  vi.mocked(apiPost).mockReset().mockRejectedValueOnce(new ApiClientError("La nota ya fue aprobada", 409));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  await abrirLaNota();
  corregirLaS("Borrador local sin aprobar");
  fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Aprobar/ }));
  await screen.findByRole("button", { name: "Revisar nota actual" });
  vi.mocked(apiGet).mockResolvedValueOnce({ ...sesionEnRevision(), estado: "aprobada", notaFinal: { ...NOTA, subjetivo: "Texto aprobado por la otra pestaña" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar nota actual" }));
  await screen.findByText("Texto aprobado por la otra pestaña");
  expect(screen.getByText("Borrador local sin aprobar").closest("details")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Aprobar/ })).toBeNull();
});


it("avisa un hueco de audio en la nota recuperada del servidor", async () => {
  vi.mocked(apiGet).mockResolvedValueOnce({ ...sesionEnRevision(), pausas: [{ inicio: 59800, fin: 60000, siguienteIndice: 1, motivo: "interrupcion" }] });
  await abrirLaNota();
  expect(screen.getByText("Audio posiblemente incompleto")).toBeTruthy();
  expect(screen.getByText(/puede faltar parte de lo conversado/)).toBeTruthy();
});


describe("Para vos: estados y recuperación", () => {
  const pendiente = () => ({ ...sesionEnRevision(), feedbackEstado: "pendiente" as const, modeloAsr: "whisper" });
  beforeEach(() => { vi.mocked(apiGet).mockReset(); vi.mocked(apiPost).mockReset(); });
  it("muestra fallo y pide el reintento por el contrato existente", async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...pendiente(), feedbackEstado: "fallido" });
    vi.mocked(apiPost).mockResolvedValue(pendiente());
    render(<ProteccionTrabajo><SesionDetailView id="ses_1" vista="para-vos" /></ProteccionTrabajo>);
    fireEvent.click(await screen.findByRole("button", { name: "Volver a pedir Para vos" }));
    expect(apiPost).toHaveBeenCalledExactlyOnceWith("/api/sesion-clinica/ses_1/feedback/reintentar", {});
    await screen.findByText("Se está generando…");
    expect(screen.queryByRole("button", { name: "Volver a pedir Para vos" })).toBeNull();
  });
  it("si pierde la respuesta, reconoce el pedido ya creado sin afirmar un fallo", async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ ...pendiente(), feedbackEstado: "no_pedido" }).mockResolvedValue(pendiente());
    vi.mocked(apiPost).mockRejectedValue(new Error("Respuesta perdida"));
    render(<ProteccionTrabajo><SesionDetailView id="ses_1" vista="para-vos" /></ProteccionTrabajo>);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar Para vos" }));
    await screen.findByText("Se está generando…");
    expect(screen.queryByText(/No pudimos confirmar el pedido/)).toBeNull();
  });
  it("relee un pendiente y muestra su fallo sin quedarse esperando para siempre", async () => {
    vi.mocked(apiGet).mockResolvedValueOnce(pendiente()).mockResolvedValue({ ...pendiente(), feedbackEstado: "fallido" });
    vi.useFakeTimers();
    try {
      render(<ProteccionTrabajo><SesionDetailView id="ses_1" vista="para-vos" /></ProteccionTrabajo>);
      await act(async () => {});
      expect(screen.getByText("Se está generando…")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(screen.getByText("No se pudo generar.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Volver a pedir Para vos" })).toBeTruthy();
      expect(apiGet).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(apiGet).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

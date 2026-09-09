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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";
import {
  CAMBIOS_SIN_APROBAR_TITULO,
  EDITAR,
  IR_IGUAL,
  QUEDARME,
  SOAP_S,
  VOLVER,
} from "@/lib/glosario";

import { SesionDetailView } from "../sesion-detail-view";

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

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => Promise.resolve(sesionEnRevision())),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  esAbort: () => false,
}));

function sesionEnRevision(): SesionClinicaResponse {
  return {
    id: "ses_1",
    turnoId: "t_1",
    estado: "revision",
    duracionAudioSeg: 3000,
    audioR2Key: null,
    audioBorradoEn: null,
    notaSubjetivo: "Relató la semana.",
    notaObjetivo: "Se la vio cansada.",
    notaAnalisis: "Sigue el mismo hilo.",
    notaPlan: "Retomar el trabajo.",
    notaSoapOriginal: null,
    // Sin señal de riesgo: aprobar no depende de ninguna casilla y la nota
    // es editable de entrada.
    datosEstructurados: {},
    modeloASR: null,
    modeloLLM: null,
    promptVersion: null,
    hablanteTerapeuta: null,
    procesadoEn: null,
    aprobadoEn: null,
    error: null,
    intentos: 1,
    createdAt: "2026-09-07T13:00:00.000Z",
    updatedAt: "2026-09-07T13:00:00.000Z",
    turno: {
      id: "t_1",
      fecha: "2026-09-07T13:00:00.000Z",
      paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" },
    },
  } as unknown as SesionClinicaResponse;
}

/** Monta la nota y espera a que llegue la fila. */
async function abrirLaNota() {
  render(<SesionDetailView id="ses_1" />);
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
    expect(screen.getByText(CAMBIOS_SIN_APROBAR_TITULO)).toBeTruthy();
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
    const agregar = vi.spyOn(window, "addEventListener");
    const quitar = vi.spyOn(window, "removeEventListener");

    await abrirLaNota();
    // Sin correcciones no hay nada registrado.
    expect(
      agregar.mock.calls.some(([evento]) => evento === "beforeunload"),
    ).toBe(false);

    corregirLaS("Relató la semana, con más detalle del trabajo.");
    await waitFor(() =>
      expect(
        agregar.mock.calls.some(([evento]) => evento === "beforeunload"),
      ).toBe(true),
    );

    // Deshacer la corrección da de baja el aviso: el navegador no pregunta
    // por una nota que quedó igual que en la fila.
    corregirLaS("Relató la semana.");
    await waitFor(() =>
      expect(
        quitar.mock.calls.some(([evento]) => evento === "beforeunload"),
      ).toBe(true),
    );

    agregar.mockRestore();
    quitar.mockRestore();
  });
});

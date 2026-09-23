// @vitest-environment jsdom
//
// La vista "Transcripción": qué se ve con un texto normal, con una línea
// rara, sin texto todavía (409), con un error, y cómo busca. Y lo que no se
// ve pero importa: cada lectura queda auditada, así que se pide una sola vez
// por apertura y nunca al entrar a la nota.

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { apiGet, apiPost, ApiClientError } from "@/lib/api-client";
import {
  BUSCAR_ANTERIOR,
  BUSCAR_EN_TRANSCRIPCION,
  BUSCAR_MINIMO,
  BUSCAR_SIGUIENTE,
  REINTENTAR,
  TRANSCRIPCION,
  TRANSCRIPCION_ERROR_TITULO,
  TRANSCRIPCION_HABLANTES,
  TRANSCRIPCION_SIN_TEXTO_TITULO,
  VISTA_NOTA,
} from "@/lib/glosario";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { CabeceraSesion } from "../cabecera-sesion";
import { HABLANTE_1, HABLANTE_2 } from "../textos";
import { SesionDetailView } from "../sesion-detail-view";
import { TranscripcionView } from "../transcripcion-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/useSesionClinicaPolling", () => ({
  ESTADOS_ACTIVOS: new Set(["grabando", "subiendo", "procesando"]),
  useSesionClinicaPolling: () => undefined,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  esAbort: () => false,
}));

const TEXTO = [
  "[00:03] Terapeuta: ¿Cómo estuvo la semana?",
  "[00:09] Paciente: Con mucha angustia. La angustia de siempre.",
  "(se corta el audio unos segundos)",
  "[01:15] Terapeuta: ¿Dónde sentís esa Angustia?",
].join("\n");

function sesion(): SesionClinicaResponse {
  return {
    id: "ses_1", turnoId: "t_1", estado: "aprobada", generacion: 1, transcripcionDisponible: true,
    notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" }, notaFinal: null, datos: {},
    feedbackEstado: "listo", feedback: null, modeloAsr: null,
    // 01:30 UTC del 19 es 22:30 del 18 en el consultorio.
    turno: { id: "t_1", fecha: "2026-09-19T01:30:00.000Z", paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" } },
  } as unknown as SesionClinicaResponse;
}

const lecturas = () => vi.mocked(apiGet).mock.calls.filter(([ruta]) => String(ruta).endsWith("/transcripcion"));

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation((ruta: string) =>
    Promise.resolve((ruta.endsWith("/transcripcion") ? { transcripcion: TEXTO, hablanteTerapeuta: "S0" } : sesion()) as never),
  );
  push.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("la cabecera", () => {
  it("dice el día Y la hora del consultorio, para distinguir dos sesiones del mismo día", () => {
    render(<CabeceraSesion sesion={sesion()} rotulo={TRANSCRIPCION} />);
    const cuando = screen.getByText("viernes 18 de septiembre · 22:30");
    expect(cuando.tagName).toBe("TIME");
    expect(screen.getByText("Nota guardada")).toBeTruthy();
  });
});

describe("TranscripcionView", () => {
  it("muestra los bloques con marca de tiempo y hablante, y aclara quién los asignó", async () => {
    render(<TranscripcionView sesion={sesion()} />);
    expect(await screen.findByText("¿Cómo estuvo la semana?")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Lucía Fernández" })).toBeTruthy();
    expect(screen.getByText(TRANSCRIPCION_HABLANTES)).toBeTruthy();
    const bloques = screen.getAllByRole("listitem");
    expect(bloques).toHaveLength(4);
    expect(within(bloques[1]).getByText("00:09")).toBeTruthy();
    expect(within(bloques[1]).getByText(HABLANTE_2)).toBeTruthy();
    expect(within(bloques[3]).getByText("01:15")).toBeTruthy();
  });

  it("no afirma quién es quién: Terapeuta y Paciente se ven como Hablante 1 y Hablante 2, cada uno con su color", async () => {
    const pedidos = vi.spyOn(globalThis, "fetch");
    render(<TranscripcionView sesion={sesion()} />);
    await screen.findByText("¿Cómo estuvo la semana?");
    const bloques = screen.getAllByRole("listitem");

    const uno = within(bloques[0]).getByText(HABLANTE_1);
    const dos = within(bloques[1]).getByText(HABLANTE_2);
    expect(within(bloques[3]).getByText(HABLANTE_1).className).toBe(uno.className);
    expect(uno.className).not.toBe(dos.className);
    expect(screen.queryByText("Terapeuta")).toBeNull();
    expect(screen.queryByText("Paciente")).toBeNull();
    // Sigue el aviso de que el reparto es automático.
    expect(screen.getByText(TRANSCRIPCION_HABLANTES)).toBeTruthy();

    // Es presentación: no se escribe nada de vuelta.
    expect(apiPost).not.toHaveBeenCalled();
    expect(pedidos).not.toHaveBeenCalled();
    pedidos.mockRestore();
  });

  it("un rótulo que no es del worker se muestra tal cual", async () => {
    vi.mocked(apiGet).mockResolvedValue({ transcripcion: "[00:01] Hablante C: Hola." } as never);
    render(<TranscripcionView sesion={sesion()} />);
    expect(await screen.findByText("Hablante C")).toBeTruthy();
  });

  it("una línea rara se ve entera", async () => {
    render(<TranscripcionView sesion={sesion()} />);
    expect(await screen.findByText("(se corta el audio unos segundos)")).toBeTruthy();
  });

  it("409: explica que todavía no hay texto, sin lista ni buscador", async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiClientError("La sesión todavía no tiene transcripción", 409));
    render(<TranscripcionView sesion={sesion()} />);
    expect(await screen.findByText(TRANSCRIPCION_SIN_TEXTO_TITULO)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("un texto en blanco tampoco se muestra como si fuera la transcripción", async () => {
    vi.mocked(apiGet).mockResolvedValue({ transcripcion: " \n " } as never);
    render(<TranscripcionView sesion={sesion()} />);
    expect(await screen.findByText(TRANSCRIPCION_SIN_TEXTO_TITULO)).toBeTruthy();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("otro error lo dice y reintentar vuelve a pedir", async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiClientError("Se cayó la conexión", 500));
    render(<TranscripcionView sesion={sesion()} />);
    const aviso = await screen.findByRole("alert");
    expect(within(aviso).getByText(TRANSCRIPCION_ERROR_TITULO)).toBeTruthy();
    expect(within(aviso).getByText("Se cayó la conexión")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();

    fireEvent.click(within(aviso).getByRole("button", { name: REINTENTAR }));
    expect(await screen.findByText("¿Cómo estuvo la semana?")).toBeTruthy();
    expect(lecturas()).toHaveLength(2);
  });

  it("se pide una sola vez por apertura, aunque React monte dos veces", async () => {
    render(<React.StrictMode><TranscripcionView sesion={sesion()} /></React.StrictMode>);
    await screen.findByText("¿Cómo estuvo la semana?");
    // Buscar no vuelve a pedir: la búsqueda es local.
    fireEvent.change(screen.getByRole("searchbox", { name: BUSCAR_EN_TRANSCRIPCION }), { target: { value: "angustia" } });
    expect(lecturas()).toHaveLength(1);
    expect(lecturas()[0][0]).toBe("/api/sesion-clinica/ses_1/transcripcion");
  });

  it("no guarda el texto en el almacenamiento del navegador", async () => {
    const guardar = vi.spyOn(Storage.prototype, "setItem");
    render(<TranscripcionView sesion={sesion()} />);
    await screen.findByText("¿Cómo estuvo la semana?");
    expect(guardar).not.toHaveBeenCalled();
    guardar.mockRestore();
  });
});

describe("el buscador", () => {
  async function abrir() {
    render(<TranscripcionView sesion={sesion()} />);
    await screen.findByText("¿Cómo estuvo la semana?");
    return screen.getByRole("searchbox", { name: BUSCAR_EN_TRANSCRIPCION });
  }
  const actual = () => document.querySelector("mark[data-actual]");

  it("cuenta, resalta, va al resultado y recorre con anterior y siguiente", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "angustia" } });

    expect(screen.getByText("1 de 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: BUSCAR_ANTERIOR }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: BUSCAR_SIGUIENTE }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelectorAll("mark")).toHaveLength(3);
    expect(Array.from(document.querySelectorAll("mark"), (m) => m.textContent)).toEqual(["angustia", "angustia", "Angustia"]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const primero = actual();

    fireEvent.click(screen.getByRole("button", { name: BUSCAR_SIGUIENTE }));
    expect(screen.getByText("2 de 3")).toBeTruthy();
    expect(actual()).not.toBe(primero);

    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByText("3 de 3")).toBeTruthy();
    expect(actual()?.textContent).toBe("Angustia");

    // Da la vuelta, para los dos lados.
    fireEvent.click(screen.getByRole("button", { name: BUSCAR_SIGUIENTE }));
    expect(screen.getByText("1 de 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: BUSCAR_ANTERIOR }));
    expect(screen.getByText("3 de 3")).toBeTruthy();
  });

  it("con una sola coincidencia dice 1 de 1 y las flechas quedan apagadas", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "semana" } });
    expect(screen.getByText("1 de 1")).toBeTruthy();
    expect(document.querySelectorAll("mark")).toHaveLength(1);
    const anterior = screen.getByRole("button", { name: BUSCAR_ANTERIOR }) as HTMLButtonElement;
    const siguiente = screen.getByRole("button", { name: BUSCAR_SIGUIENTE }) as HTMLButtonElement;
    expect(anterior.disabled).toBe(true);
    expect(siguiente.disabled).toBe(true);
    // Enter tampoco se mueve ni rompe el contador.
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByText("1 de 1")).toBeTruthy();
  });

  it("sin resultados lo dice con la palabra buscada, y no deja nada resaltado", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "hermano" } });
    expect(screen.getByText("No aparece «hermano» en esta transcripción.")).toBeTruthy();
    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect((screen.getByRole("button", { name: BUSCAR_SIGUIENTE }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: BUSCAR_ANTERIOR }) as HTMLButtonElement).disabled).toBe(true);
    // El texto sigue entero.
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("vacía no muestra contador ni aviso; una sola letra pide otra", async () => {
    const campo = await abrir();
    expect(screen.queryByText(/ de \d/)).toBeNull();
    expect(within(screen.getByRole("search")).queryByRole("status")).toBeNull();
    fireEvent.change(campo, { target: { value: "a" } });
    expect(screen.getByText(BUSCAR_MINIMO)).toBeTruthy();
    expect(document.querySelectorAll("mark")).toHaveLength(0);
    fireEvent.change(campo, { target: { value: "" } });
    expect(screen.queryByText(BUSCAR_MINIMO)).toBeNull();
  });
});

describe("desde la nota", () => {
  it("entrar a la nota no pide la transcripción; se llega en un toque", async () => {
    render(<SesionDetailView id="ses_1" />);
    await screen.findByRole("heading", { level: 1, name: "Lucía Fernández" });
    expect(lecturas()).toHaveLength(0);

    expect(screen.getByRole("tab", { name: VISTA_NOTA }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: TRANSCRIPCION }));
    expect(push).toHaveBeenCalledWith("/sesiones/ses_1/transcripcion");
    expect(lecturas()).toHaveLength(0);
  });

  it("la ruta de la transcripción la abre con la misma cabecera y el selector", async () => {
    render(<SesionDetailView id="ses_1" vista="transcripcion" />);
    expect(await screen.findByText("¿Cómo estuvo la semana?")).toBeTruthy();
    expect(screen.getByText("viernes 18 de septiembre · 22:30")).toBeTruthy();
    expect(screen.getByRole("tab", { name: TRANSCRIPCION }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(lecturas()).toHaveLength(1));
  });
});

// @vitest-environment jsdom
//
// La conversación con Lux contra un fetch falso, como el panel de ayuda: lo
// que se mira es lo que ella ve mientras la respuesta llega, y lo que sale
// hacia POST /api/pacientes/{id}/lux.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversacionLux } from "../conversacion-lux";
import {
  LUX_CONVERSACION,
  LUX_EN_QUE_ME_BASO,
  LUX_NUEVA,
  LUX_PENSANDO,
  LUX_PLACEHOLDER,
  LUX_TOPE,
  luxMirando,
  luxQueLee,
  luxSaludo,
} from "@/lib/glosario";

/** Un stream que el test alimenta de a un fragmento. */
function streamManual() {
  const codificador = new TextEncoder();
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { control = c; } });
  return {
    respuesta: new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    async mandar(texto: string) {
      await act(async () => { control.enqueue(codificador.encode(texto)); await new Promise((r) => setTimeout(r, 0)); });
    },
    async cerrar() {
      await act(async () => { control.close(); await new Promise((r) => setTimeout(r, 0)); });
    },
  };
}

const respuestaEntera = (texto: string) =>
  new Response(texto, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const cuerpos = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const hilo = () => screen.getByRole("log", { name: LUX_CONVERSACION });

function montar(pacienteId = "p1", paciente = "Ana") {
  return render(<ConversacionLux pacienteId={pacienteId} paciente={paciente} profesional="Mariana" />);
}

function escribirYEnviar(texto: string) {
  const campo = screen.getByPlaceholderText(LUX_PLACEHOLDER);
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: "Enter" });
}

describe("apertura", () => {
  it("saluda la app de inmediato, dice qué lee Lux y Lux habla primero, en streaming", async () => {
    const stream = streamManual();
    fetchMock.mockResolvedValueOnce(stream.respuesta);
    montar();

    expect(screen.getByText(luxSaludo("Mariana", "Ana"))).toBeTruthy();
    expect(screen.getByText(luxQueLee("Ana"))).toBeTruthy();
    expect(screen.getByText(luxQueLee("Ana")).textContent).toContain("No guarda esta conversación.");
    expect(screen.getByText(LUX_PENSANDO)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pacientes/p1/lux");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(cuerpos()[0]).toEqual({});

    await stream.mandar("Repasé las últimas ");
    expect(hilo().textContent).toContain("Repasé las últimas");
    expect(screen.queryByText(LUX_PENSANDO)).toBeNull();
    await stream.mandar("tres sesiones.");
    expect(hilo().textContent).toContain("Repasé las últimas tres sesiones.");
    await stream.cerrar();
    expect(hilo().textContent).toContain("Repasé las últimas tres sesiones.");
  });

  it("sin nombre de la profesional saluda con 'Hola' a secas", () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    render(<ConversacionLux pacienteId="p1" paciente="Ana" profesional="" />);
    expect(screen.getByText("Hola, dame un momentito que repaso lo de Ana…")).toBeTruthy();
  });
});

describe("lo que llega dentro del texto", () => {
  it("las citas se pliegan bajo 'Ver en qué me baso' y nunca asoman las etiquetas", async () => {
    const stream = streamManual();
    fetchMock.mockResolvedValueOnce(stream.respuesta);
    montar();

    await stream.mandar("<citas>Nota del 0");
    expect(hilo().textContent).not.toContain("<citas>");
    expect(hilo().textContent).not.toContain("Nota del 0");
    await stream.mandar("3/10 · Recorrido vigente</citas>Empecemos por el sueño.");
    await stream.cerrar();

    const resumen = screen.getByText(LUX_EN_QUE_ME_BASO);
    const plegado = resumen.closest("details") as HTMLDetailsElement;
    expect(plegado.open).toBe(false);
    expect(within(plegado).getByText("Nota del 03/10 · Recorrido vigente")).toBeTruthy();
    expect(hilo().textContent).toContain("Empecemos por el sueño.");
    expect(hilo().textContent).not.toMatch(/<\/?citas>/);
    fireEvent.click(resumen);
    expect(plegado.open).toBe(true);
  });

  it("'mirando la transcripción' es un estado en gris, no un mensaje de Lux", async () => {
    const stream = streamManual();
    fetchMock.mockResolvedValueOnce(stream.respuesta);
    montar();

    await stream.mandar("Dejame ver.\n_(mirando la tra");
    expect(hilo().textContent).not.toContain("mirando");
    await stream.mandar("nscripción del 03/10)_\nAhí contó que no durmió.");
    await stream.cerrar();

    const estado = screen.getByText(luxMirando("03/10"));
    expect(estado.textContent).not.toContain("Lux:");
    expect(estado.className).toContain("text-ink-500");
    const mensajes = within(hilo()).getAllByText((_, el) => el?.tagName === "P" && !!el.textContent?.startsWith("Lux:"));
    expect(mensajes.map((m) => m.textContent)).toEqual(["Lux: Dejame ver.", "Lux: Ahí contó que no durmió."]);
    expect(hilo().textContent).not.toContain("_(");
  });
});

describe("preguntar", () => {
  it("Enter envía con el historial, Shift+Enter no envía", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("<citas>Nota del 03/10</citas>Hola, ¿qué querés repasar?"));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const campo = screen.getByPlaceholderText(LUX_PLACEHOLDER);
    fireEvent.change(campo, { target: { value: "¿Cómo viene\ncon el sueño?" } });
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(respuestaEntera("Mejor que en septiembre."));
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cuerpos()[1]).toEqual({
      pregunta: "¿Cómo viene\ncon el sueño?",
      historial: [{ rol: "asistente", texto: "Hola, ¿qué querés repasar?" }],
    });
    expect((campo as HTMLTextAreaElement).value).toBe("");
    expect(hilo().textContent).toContain("Mejor que en septiembre.");
  });

  it("un 429 muestra el tope del día y la pregunta vuelve al campo", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "tope" }), { status: 429 }));
    await act(async () => { escribirYEnviar("¿Y la medicación?"); });

    expect(screen.getByRole("alert").textContent).toBe(LUX_TOPE);
    expect(LUX_TOPE).toContain("Lux llegó a su tope de hoy");
    expect((screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement).value).toBe("¿Y la medicación?");
    expect(hilo().textContent).not.toContain("¿Y la medicación?");
  });

  it("si ella ya empezó otra pregunta mientras esperaba, el error no se la pisa", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    let fallar!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolver) => { fallar = resolver; }));
    escribirYEnviar("Primera pregunta");
    const campo = screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "Otra a medio escribir" } });
    await act(async () => { fallar(new Response("", { status: 500 })); await new Promise((r) => setTimeout(r, 0)); });

    expect(campo.value).toBe("Otra a medio escribir");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("si el tope llega en la apertura también lo dice", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByRole("alert").textContent).toBe(LUX_TOPE);
  });
});

describe("la conversación no se guarda", () => {
  it("'Nueva conversación' vacía el hilo y vuelve a abrir sin historial", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Primera apertura."));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fetchMock.mockResolvedValueOnce(respuestaEntera("Respuesta vieja."));
    await act(async () => { escribirYEnviar("Pregunta vieja"); });
    expect(hilo().textContent).toContain("Respuesta vieja.");

    fetchMock.mockResolvedValueOnce(respuestaEntera("Segunda apertura."));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: LUX_NUEVA })); });

    expect(hilo().textContent).not.toContain("Pregunta vieja");
    expect(hilo().textContent).not.toContain("Respuesta vieja.");
    expect(hilo().textContent).toContain("Segunda apertura.");
    expect(cuerpos().at(-1)).toEqual({});
  });

  it("al cambiar de paciente no queda nada de la anterior", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Ana viene bien."));
    const { rerender } = montar("p1", "Ana");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const campo = screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "algo sobre Ana" } });

    fetchMock.mockResolvedValueOnce(respuestaEntera("Beto arrancó hace poco."));
    await act(async () => {
      rerender(<ConversacionLux pacienteId="p2" paciente="Beto" profesional="Mariana" />);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(hilo().textContent).not.toContain("Ana");
    expect(campo.value).toBe("");
    expect(hilo().textContent).toContain("Beto arrancó hace poco.");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/pacientes/p2/lux");
    expect(cuerpos().at(-1)).toEqual({});
  });

  it("no escribe nada en localStorage ni en sessionStorage", async () => {
    const escribir = vi.spyOn(Storage.prototype, "setItem");
    fetchMock.mockResolvedValueOnce(respuestaEntera("<citas>Nota</citas>Hola."));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fetchMock.mockResolvedValueOnce(respuestaEntera("Respuesta."));
    await act(async () => { escribirYEnviar("Pregunta clínica"); });
    fireEvent.change(screen.getByPlaceholderText(LUX_PLACEHOLDER), { target: { value: "sin mandar" } });

    expect(escribir).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(window.history.state ?? null)).not.toMatch(/Pregunta clínica|Respuesta|sin mandar/);
  });
});

describe("a 360 px", () => {
  // jsdom no mide: lo que se verifica es la caja que impide el desborde —
  // texto que corta palabras largas, contenedores que pueden achicarse, nada
  // con ancho fijo—. La medida real la hace el recorrido de pruebas/e2e.
  it("el texto largo corta y nada tiene ancho fijo", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera(`<citas>${"x".repeat(200)}</citas>${"palabralarguísima".repeat(20)}`));
    const { container } = montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    for (const p of container.querySelectorAll("p")) {
      if (p.classList.contains("sr-only")) continue;
      const cortaPalabras = p.className.includes("break-words");
      const esLinea = p.closest("[role=log]") === null;
      expect(cortaPalabras || esLinea, p.textContent ?? "").toBe(true);
    }
    expect(container.innerHTML).not.toMatch(/\b(w|min-w)-\[\d{3,}px\]/);
    expect(hilo().className).toContain("overflow-x-hidden");
    expect(hilo().className).toContain("min-w-0");
    const campo = screen.getByPlaceholderText(LUX_PLACEHOLDER);
    expect(campo.className).toContain("min-w-0");
    expect(campo.className).toContain("flex-1");
  });
});

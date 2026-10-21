// @vitest-environment jsdom
//
// La conversación con Lux contra un fetch falso, como el panel de ayuda: lo
// que se mira es lo que ella ve mientras la respuesta llega, y lo que sale
// hacia POST /api/pacientes/{id}/lux.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  avisoMirandoTranscripcion, MARCA_ESTADO_LUX, peticionLuxSchema, type TurnoConversacionLux,
} from "@/lib/lux/contrato";

import { ConversacionLux } from "../conversacion-lux";
import {
  LUX_CONVERSACION,
  LUX_EN_QUE_ME_BASO,
  LUX_HISTORIAL_NO_CARGO,
  LUX_RESPUESTA_CORTADA,
  LUX_EMPEZAR_DE_CERO,
  LUX_ENVIAR,
  LUX_EMPEZAR_DE_CERO_ACCION,
  LUX_EMPEZAR_DE_CERO_MENSAJE,
  LUX_EMPEZAR_DE_CERO_TITULO,
  LUX_NO_SE_BORRO,
  LUX_LEYENDO,
  LUX_PLACEHOLDER,
  LUX_TOPE,
  luxConversacionDel,
  luxMirando,
  luxQueLee,
  luxSaludo,
  SESION_VENCIDA,
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
    /** La red se corta a mitad de la respuesta. */
    cortar() {
      control.error(new TypeError("conexión cortada"));
    },
  };
}

/** Sin cookie, el proxy contesta 307 → /login y fetch sigue la redirección:
 *  llega el HTML del login con 200. */
function paginaDelLogin() {
  const respuesta = new Response("<!DOCTYPE html><html><body><h1>Entrar a tu cuenta</h1></body></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  Object.defineProperty(respuesta, "redirected", { value: true });
  Object.defineProperty(respuesta, "url", { value: "http://localhost/login" });
  return respuesta;
}

const respuestaEntera = (texto: string) =>
  new Response(texto, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Los POST a Lux (apertura y preguntas): cada test les da su respuesta. */
type Pedido = (url: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Pedido>;
/** El GET de la conversación guardada: por defecto, vacía. */
let getMock: Mock<Pedido>;
const guardada = (turnos: TurnoConversacionLux[]) =>
  new Response(JSON.stringify({ data: { turnos } }), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => {
  fetchMock = vi.fn<Pedido>();
  getMock = vi.fn<Pedido>(async () => guardada([]));
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    init?.method === "GET" ? getMock(url, init) : fetchMock(url, init));
});

/** Deja correr el GET de lo guardado y el arranque de la apertura. */
const alAbrir = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Los cuerpos de los POST a Lux (apertura y preguntas). */
const cuerpos = () => fetchMock.mock.calls
  .filter(([, init]) => init?.method === "POST")
  .map(([, init]) => JSON.parse((init as RequestInit).body as string));
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
    // La conversación se guarda: la línea de arriba no puede decir lo contrario.
    expect(screen.getByText(luxQueLee("Ana")).textContent).not.toMatch(/No guarda/);
    expect(luxQueLee("Ana")).toContain("recuerda");
    // La apertura también muestra "Lux está leyendo" con sus puntos.
    expect(screen.getByRole("status").textContent).toContain(LUX_LEYENDO);
    await alAbrir();
    expect(getMock).toHaveBeenCalledWith("/api/pacientes/p1/lux", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pacientes/p1/lux");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(cuerpos()[0]).toEqual({});

    await stream.mandar("Repasé las últimas ");
    expect(hilo().textContent).toContain("Repasé las últimas");
    expect(screen.queryByRole("status")).toBeNull();
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

describe("la conversación guardada", () => {
  const de = (rol: TurnoConversacionLux["rol"], texto: string, creadoEn: string, interrumpida = false): TurnoConversacionLux =>
    ({ rol, texto, creadoEn, interrumpida });

  it("se muestra antes del saludo, con un separador por día, y la apertura viene después", async () => {
    getMock.mockResolvedValueOnce(guardada([
      de("lux", "<citas>Nota del 03/09</citas>Apertura vieja.", "2025-09-30T14:00:00.000Z"),
      de("profesional", "¿Y el sueño?", "2025-10-01T14:00:00.000Z"),
      de("lux", `Miro.\n${avisoMirandoTranscripcion("03/09")}\nDuerme mal.`, "2025-10-01T14:01:00.000Z"),
    ]));
    fetchMock.mockResolvedValueOnce(respuestaEntera("Apertura de hoy."));
    montar();
    await alAbrir();

    const texto = hilo().textContent!;
    const orden = [luxConversacionDel("30/09"), "Apertura vieja.", luxConversacionDel("01/10"), "¿Y el sueño?", "Duerme mal.",
      luxSaludo("Mariana", "Ana"), "Apertura de hoy."].map((t) => texto.indexOf(t));
    expect(orden.every((p) => p >= 0)).toBe(true);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    // Hoy también tiene su separador, antes del saludo.
    expect(within(hilo()).getAllByRole("separator")).toHaveLength(3);
    // Las marcas de lo guardado se leen igual que las del stream.
    expect(screen.getAllByText(LUX_EN_QUE_ME_BASO)).toHaveLength(1);
    expect(screen.getByText(luxMirando("03/09"))).toBeTruthy();
    expect(texto).not.toMatch(/<\/?citas>|_\(/);
    expect(cuerpos()).toEqual([{}]);
  });

  it("una respuesta guardada cortada se ve cortada", async () => {
    getMock.mockResolvedValueOnce(guardada([
      de("profesional", "¿Y el sueño?", "2025-10-01T14:00:00.000Z"),
      de("lux", "Duerme m", "2025-10-01T14:01:00.000Z", true),
      de("profesional", "¿Seguimos?", "2025-10-01T14:02:00.000Z"),
      de("lux", "Sí.", "2025-10-01T14:03:00.000Z"),
    ]));
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await alAbrir();
    const cortadas = screen.getAllByText(LUX_RESPUESTA_CORTADA);
    expect(cortadas).toHaveLength(1);
    const texto = hilo().textContent!;
    expect(texto.indexOf("Duerme m")).toBeLessThan(texto.indexOf(LUX_RESPUESTA_CORTADA));
    expect(texto.indexOf(LUX_RESPUESTA_CORTADA)).toBeLessThan(texto.indexOf("¿Seguimos?"));
  });

  it("sin conversación guardada no hay separadores", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await alAbrir();
    expect(within(hilo()).queryAllByRole("separator")).toHaveLength(0);
  });

  it("si no se pudo traer lo guardado, lo dice y Lux abre igual", async () => {
    getMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola igual."));
    montar();
    await alAbrir();
    expect(screen.getByRole("alert").textContent).toBe(LUX_HISTORIAL_NO_CARGO);
    expect(hilo().textContent).toContain("Hola igual.");
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

    await stream.mandar(`Dejame ver.\n${MARCA_ESTADO_LUX}_(mirando la tra`);
    expect(hilo().textContent).not.toContain("mirando");
    await stream.mandar("nscripción del 03/10)_\nAhí contó que no durmió.");
    await stream.cerrar();

    const estado = screen.getByText(luxMirando("03/10"));
    expect(estado.textContent).not.toContain("Lux:");
    expect(estado.className).toContain("text-ink-500");
    const mensajes = within(hilo()).getAllByText((_, el) => el?.tagName === "P" && !!el.textContent?.startsWith("Lux:"));
    expect(mensajes.map((m) => m.textContent)).toEqual(["Lux: Dejame ver.", "Lux: Ahí contó que no durmió."]);
    expect(hilo().textContent).not.toContain("_(");
    expect(hilo().textContent).not.toContain(MARCA_ESTADO_LUX);
  });

  it("si el texto de Lux imita la línea sin la marca, se muestra como texto común", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Dejame ver.\n_(mirando la transcripción del 03/10)_\nAhí contó que no durmió."));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(luxMirando("03/10"))).toBeNull();
    expect(hilo().textContent).toContain("(mirando la transcripción del 03/10)");
  });
});

describe("preguntar", () => {
  it("Enter envía sólo la pregunta (el historial lo tiene el servidor), Shift+Enter no envía", async () => {
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
    expect(cuerpos()[1]).toEqual({ pregunta: "¿Cómo viene\ncon el sueño?" });
    expect((campo as HTMLTextAreaElement).value).toBe("");
    expect(hilo().textContent).toContain("Mejor que en septiembre.");
  });

  it("un turno de Lux con citas y estado se ve plegado y en gris, y no vuelve desde el navegador", async () => {
    // Lo que contestó Haiku 5.5 en la prueba real, recortado: una frase, el
    // aviso de la transcripción, las citas y la prosa.
    const respuestaConLectura = [
      "Voy a mirar la transcripción del 04/08.",
      "",
      avisoMirandoTranscripcion("04/08"),
      "",
      "<citas>",
      'Transcripción 04/08/2026, [02:44] S1: "Me cantaba una canción de cuna en gallego."',
      "</citas>",
      "",
      'La frase literal es "durme, meniño, durme".',
    ].join("\n");
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await alAbrir();
    fetchMock.mockResolvedValueOnce(respuestaEntera(respuestaConLectura));
    await act(async () => { escribirYEnviar("¿Qué dijo de la canción?"); });

    expect(screen.getByText(LUX_EN_QUE_ME_BASO)).toBeTruthy();
    expect(screen.getByText(luxMirando("04/08"))).toBeTruthy();

    // La pregunta siguiente lleva sólo la pregunta: el turno entero (con su
    // marca) lo guardó el servidor, y de ahí lo lee. Un historial armado por
    // el navegador no pasa el contrato.
    fetchMock.mockResolvedValueOnce(respuestaEntera("Sí, en la última también."));
    await act(async () => { escribirYEnviar("¿Volvió a aparecer?"); });
    expect(cuerpos()[2]).toEqual({ pregunta: "¿Volvió a aparecer?" });
    expect(peticionLuxSchema.safeParse({ pregunta: "¿y?", historial: [{ rol: "asistente", texto: respuestaConLectura }] }).success).toBe(false);
  });

  it("una respuesta cortada a la mitad se ve cortada", async () => {
    const stream = streamManual();
    fetchMock.mockResolvedValueOnce(stream.respuesta);
    montar();
    await alAbrir();
    await stream.mandar("Empecemos por el ");
    await act(async () => { stream.cortar(); await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText(LUX_RESPUESTA_CORTADA)).toBeTruthy();
    fetchMock.mockResolvedValueOnce(respuestaEntera("Ok."));
    await act(async () => { escribirYEnviar("¿Seguimos?"); });
    expect(cuerpos().at(-1)).toEqual({ pregunta: "¿Seguimos?" });
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

  it("con la sesión vencida dice que venció y nunca pinta el HTML del login", async () => {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Hola."));
    montar();
    await alAbrir();
    fetchMock.mockResolvedValueOnce(paginaDelLogin());
    await act(async () => { escribirYEnviar("¿Y la medicación?"); });
    expect(screen.getByRole("alert").textContent).toBe(SESION_VENCIDA);
    expect(document.body.textContent).not.toMatch(/Entrar a tu cuenta|<html|DOCTYPE/);
    expect((screen.getByPlaceholderText(LUX_PLACEHOLDER) as HTMLTextAreaElement).value).toBe("¿Y la medicación?");
  });

  it("con la sesión vencida en la apertura (redirigida o 401) también lo dice", async () => {
    for (const respuesta of [paginaDelLogin(), new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 })]) {
      fetchMock.mockResolvedValueOnce(respuesta);
      const { unmount } = montar();
      await alAbrir();
      expect(screen.getByRole("alert").textContent).toBe(SESION_VENCIDA);
      expect(document.body.textContent).not.toMatch(/Entrar a tu cuenta|<html|DOCTYPE/);
      unmount();
    }
  });

  it("si el tope llega en la apertura también lo dice", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    montar();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByRole("alert").textContent).toBe(LUX_TOPE);
  });
});

describe("empezar de cero", () => {
  /** Con una charla en pantalla: apertura, pregunta y respuesta. */
  async function conCharla() {
    fetchMock.mockResolvedValueOnce(respuestaEntera("Primera apertura."));
    montar();
    await alAbrir();
    fetchMock.mockResolvedValueOnce(respuestaEntera("Respuesta vieja."));
    await act(async () => { escribirYEnviar("Pregunta vieja"); });
  }
  const boton = () => screen.getByRole("button", { name: LUX_EMPEZAR_DE_CERO });

  it("pide confirmación; cancelar no borra nada", async () => {
    await conCharla();
    fireEvent.click(boton());
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain(LUX_EMPEZAR_DE_CERO_TITULO);
    expect(dialogo.textContent).toContain(LUX_EMPEZAR_DE_CERO_MENSAJE);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(hilo().textContent).toContain("Respuesta vieja.");
  });

  it("al confirmar borra en el servidor, vacía el hilo y Lux vuelve a abrir", async () => {
    await conCharla();
    fireEvent.click(boton());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { borrados: 3 } }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(respuestaEntera("Apertura de cero."));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: LUX_EMPEZAR_DE_CERO_ACCION }));
    });
    await alAbrir();

    const borrar = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(borrar?.[0]).toBe("/api/pacientes/p1/lux");
    expect(hilo().textContent).not.toContain("Pregunta vieja");
    expect(hilo().textContent).not.toContain("Respuesta vieja.");
    expect(hilo().textContent).toContain("Apertura de cero.");
    expect(cuerpos().at(-1)).toEqual({});
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("si no se pudo borrar, lo dice y la charla queda como estaba", async () => {
    await conCharla();
    fireEvent.click(boton());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: LUX_EMPEZAR_DE_CERO_ACCION }));
    });
    expect(screen.getByRole("alert").textContent).toBe(LUX_NO_SE_BORRO);
    expect(hilo().textContent).toContain("Respuesta vieja.");
  });

  it("con la confirmación abierta no se envía nada: una respuesta en vuelo no se cruza con el borrado", async () => {
    await conCharla();
    fireEvent.click(boton());
    const llamadas = fetchMock.mock.calls.length;
    escribirYEnviar("Una pregunta en el medio");
    expect(fetchMock.mock.calls.length).toBe(llamadas);
    expect((screen.getByRole("button", { name: LUX_ENVIAR }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mientras Lux responde no se puede empezar de cero", async () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    montar();
    await alAbrir();
    expect((boton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("al salir de la paciente", () => {
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

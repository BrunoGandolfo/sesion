// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { z } from "zod";

const navegacion = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacion.pathname,
}));

import { PanelAyuda } from "@/components/ayuda/panel-ayuda";
import {
  ALGO_FALLO,
  AYUDA_ENVIAR,
  AYUDA_ESPERANDO,
  AYUDA_PLACEHOLDER,
  AYUDA_PREGUNTAS_INICIALES,
  AYUDA_STREAM_CORTADO,
  AYUDA_SIN_CONEXION,
  AYUDA_TOPE_DIARIO,
} from "@/lib/glosario";

// Copia literal de preguntaSchema (src/app/api/ayuda/route.ts). Está
// duplicado y no importado porque esa ruta arrastra Prisma y el corpus: lo
// que se verifica acá es que el cuerpo que arma el panel pase por el mismo
// filtro que va a encontrar del otro lado.
const LARGO_MAX_PREGUNTA = 600;
const MAX_TURNOS_HISTORIAL = 6;

const turnoSchema = z.object({
  rol: z.enum(["usuaria", "asistente"]),
  texto: z.string().trim().min(1).max(4000),
});

const preguntaSchema = z.object({
  pregunta: z.string().trim().min(1).max(LARGO_MAX_PREGUNTA),
  historial: z.array(turnoSchema).max(MAX_TURNOS_HISTORIAL * 2).optional(),
});

/** Una respuesta 2xx de /api/ayuda, en la forma que devuelve `ok()`. */
function respuestaOk(respuesta: string) {
  return new Response(respuesta, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Una respuesta de error, con el texto que la ruta manda y el panel NO
 *  muestra. */
function respuestaError(status: number) {
  return new Response(JSON.stringify({ error: "detalle técnico del servidor" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function montar() {
  render(<PanelAyuda abierto alCerrar={() => {}} />);
  // El Sheet monta el panel de mobile y el de desktop a la vez y esconde uno
  // con CSS, que en jsdom no corre: se trabaja con el primero.
  return within(screen.getAllByRole("dialog")[0]);
}

function preguntar(panel: ReturnType<typeof montar>, texto: string) {
  const campo = panel.getByPlaceholderText(AYUDA_PLACEHOLDER);
  fireEvent.change(campo, { target: { value: texto } });
  // Enter en el campo y el botón hacen lo mismo: los dos submitean el
  // formulario, que es lo que se dispara acá.
  fireEvent.submit(campo.closest("form") as HTMLFormElement);
}

/** Los cuerpos de todos los POST que se hicieron, ya parseados. */
function cuerposEnviados(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );
}

afterEach(() => {
  navegacion.pathname = "/";
  vi.unstubAllGlobals();
});

describe("PanelAyuda — primera impresión", () => {
  it("ofrece tres preguntas del corpus y tocar una la envía", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk("Listo."));
    vi.stubGlobal("fetch", fetchMock);
    const panel = montar();

    for (const pregunta of AYUDA_PREGUNTAS_INICIALES) {
      expect(panel.getByRole("button", { name: pregunta })).toBeTruthy();
    }

    fireEvent.click(
      panel.getByRole("button", { name: AYUDA_PREGUNTAS_INICIALES[0] }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(cuerposEnviados(fetchMock)[0]).toEqual({
      pregunta: AYUDA_PREGUNTAS_INICIALES[0],
    });
  });

  it("no dibuja ninguna pose en una ruta clínica", () => {
    navegacion.pathname = "/sesiones/una-sesion";
    montar();
    expect(document.querySelector("[data-pose]")).toBeNull();
  });
});

describe("PanelAyuda — streaming", () => {
  it("muestra el texto acumulado a medida que llegan fragmentos", async () => {
    let controlador!: ReadableStreamDefaultController<Uint8Array>;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        controlador = controller;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(cuerpo, { status: 200 })),
    );
    const panel = montar();
    preguntar(panel, "¿dónde está?");
    const encoder = new TextEncoder();

    await act(async () => controlador.enqueue(encoder.encode("Está en ")));
    expect(await panel.findByText("Está en")).toBeTruthy();
    await act(async () => controlador.enqueue(encoder.encode("Tu consultorio.")));
    expect(await panel.findByText("Está en Tu consultorio.")).toBeTruthy();
    await act(async () => controlador.close());
  });

  it("conserva lo recibido y avisa si el stream se corta", async () => {
    let controlador!: ReadableStreamDefaultController<Uint8Array>;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        controlador = controller;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(cuerpo, { status: 200 })),
    );
    const panel = montar();
    preguntar(panel, "¿dónde está?");
    await act(async () =>
      controlador.enqueue(new TextEncoder().encode("Lo que alcancé a ver")),
    );
    await act(async () => controlador.error(new Error("corte")));

    expect(panel.getByText("Lo que alcancé a ver")).toBeTruthy();
    expect(await panel.findByText(AYUDA_STREAM_CORTADO)).toBeTruthy();
  });
});

describe("PanelAyuda — el historial", () => {
  it("manda la pregunta sola la primera vez y con los turnos previos después", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaOk("Está en Tu consultorio, abajo de la tarifa."))
      .mockResolvedValueOnce(respuestaOk("Sí, se borra apenas se aprueba la nota."));
    vi.stubGlobal("fetch", fetchMock);

    const panel = montar();

    preguntar(panel, "¿Dónde cambio el recordatorio?");
    expect(await panel.findByText(/Tu consultorio/)).toBeTruthy();

    preguntar(panel, "¿Y el audio?");
    expect(await panel.findByText(/se borra/)).toBeTruthy();

    const [primero, segundo] = cuerposEnviados(fetchMock);

    // La primera pregunta no lleva historial: el campo es opcional y una
    // lista vacía dice lo mismo con más bytes.
    expect(primero).toEqual({ pregunta: "¿Dónde cambio el recordatorio?" });

    // La segunda lleva el par completo, del más viejo al más nuevo.
    expect(segundo).toEqual({
      pregunta: "¿Y el audio?",
      historial: [
        { rol: "usuaria", texto: "¿Dónde cambio el recordatorio?" },
        {
          rol: "asistente",
          texto: "Está en Tu consultorio, abajo de la tarifa.",
        },
      ],
    });

    // Y los dos pasan el schema de la ruta.
    for (const cuerpo of [primero, segundo]) {
      expect(preguntaSchema.safeParse(cuerpo).success).toBe(true);
    }
  });

  it("nunca manda más turnos de los que la ruta acepta", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(respuestaOk("Bueno.")));
    vi.stubGlobal("fetch", fetchMock);

    const panel = montar();

    // Ocho idas y vueltas: dieciséis turnos en el hilo, más de los doce que
    // acepta preguntaSchema.
    for (let i = 1; i <= 8; i += 1) {
      preguntar(panel, `pregunta ${i}`);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
      await panel.findAllByText("Bueno.");
    }

    const ultimo = cuerposEnviados(fetchMock).at(-1);
    const parseado = preguntaSchema.safeParse(ultimo);
    expect(parseado.success).toBe(true);
    expect(parseado.data?.historial).toHaveLength(MAX_TURNOS_HISTORIAL * 2);
    // Se recorta por el principio: los turnos que quedan son los últimos.
    expect(parseado.data?.historial?.[0]).toEqual({
      rol: "usuaria",
      texto: "pregunta 2",
    });
  });
});

describe("PanelAyuda — el hilo no sobrevive al cierre", () => {
  it("se abre vacía después de haberla cerrado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(respuestaOk("Ahí está."))),
    );

    // El menú monta el panel una sola vez y lo abre y lo cierra: el
    // componente no se desmonta, así que vaciar el hilo es trabajo suyo.
    const { rerender } = render(<PanelAyuda abierto alCerrar={() => {}} />);
    const panel = within(screen.getAllByRole("dialog")[0]);

    preguntar(panel, "¿dónde está el hilo?");
    expect(await panel.findByText("Ahí está.")).toBeTruthy();

    rerender(<PanelAyuda abierto={false} alCerrar={() => {}} />);
    rerender(<PanelAyuda abierto alCerrar={() => {}} />);

    const reabierta = within(screen.getAllByRole("dialog")[0]);
    await waitFor(() => expect(reabierta.queryByText("Ahí está.")).toBeNull());
    expect(reabierta.queryByText("¿dónde está el hilo?")).toBeNull();
  });
});

describe("PanelAyuda — los tres errores", () => {
  const casos = [
    {
      nombre: "sin conexión",
      respuesta: () => Promise.reject(new TypeError("Failed to fetch")),
      texto: AYUDA_SIN_CONEXION,
    },
    {
      nombre: "tope diario",
      respuesta: () => Promise.resolve(respuestaError(429)),
      texto: AYUDA_TOPE_DIARIO,
    },
    {
      nombre: "fallo del proveedor",
      respuesta: () => Promise.resolve(respuestaError(502)),
      texto: ALGO_FALLO,
    },
  ];

  for (const caso of casos) {
    it(`dice lo que corresponde con ${caso.nombre}`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(caso.respuesta));

      const panel = montar();
      preguntar(panel, "¿cómo grabo?");

      const aviso = await panel.findByRole("alert");
      expect(aviso.textContent).toBe(caso.texto);

      // Nunca el detalle técnico.
      expect(panel.queryByText(/detalle técnico/)).toBeNull();

      // La pregunta que no se contestó vuelve al campo, así se puede mandar
      // de nuevo sin volver a escribirla.
      expect(
        (panel.getByPlaceholderText(AYUDA_PLACEHOLDER) as HTMLInputElement).value,
      ).toBe("¿cómo grabo?");
    });
  }

  it("el botón de preguntar espera a que haya algo escrito", () => {
    vi.stubGlobal("fetch", vi.fn());
    const panel = montar();
    expect(
      (panel.getByRole("button", { name: AYUDA_ENVIAR }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("PanelAyuda — una respuesta vieja no pisa a la nueva", () => {
  it("cerrar con una pregunta en el aire y volver a preguntar: la vieja ya no manda", async () => {
    // Dos peticiones controladas a mano. La primera queda colgada; la
    // segunda contesta cuando se le dice. Resolver —no rechazar— la primera
    // es el caso que importa: abortar corta el fetch, pero si la respuesta
    // ya estaba en camino, la promesa se resuelve igual.
    let resolverVieja!: (r: Response) => void;
    let resolverNueva!: (r: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((res) => (resolverVieja = res)),
      )
      .mockImplementationOnce(
        () => new Promise<Response>((res) => (resolverNueva = res)),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<PanelAyuda abierto alCerrar={() => {}} />);
    preguntar(within(screen.getAllByRole("dialog")[0]), "la vieja");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Cierra con la respuesta todavía en el aire, y reabre.
    rerender(<PanelAyuda abierto={false} alCerrar={() => {}} />);
    rerender(<PanelAyuda abierto alCerrar={() => {}} />);

    const panel = within(screen.getAllByRole("dialog")[0]);
    preguntar(panel, "la nueva");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await panel.findByText(AYUDA_ESPERANDO)).toBeTruthy();

    // Llega la respuesta de la pregunta que ella ya no está haciendo.
    // `act` vacía la cola: fetch resuelve, `desenvolver` hace res.json() y
    // recién ahí correrían los setState. Sin esto, afirmar que algo NO pasó
    // pasa siempre, porque todavía no pasó nada.
    await act(async () => {
      resolverVieja(respuestaOk("contesto la vieja"));
    });

    // No entra al hilo...
    await waitFor(() => {
      expect(panel.queryByText("contesto la vieja")).toBeNull();
    });
    // ...y no apaga el anillo de la nueva, que sigue esperando.
    expect(panel.queryByText(AYUDA_ESPERANDO)).toBeTruthy();
    expect(panel.queryByText("la vieja")).toBeNull();

    // El hilo queda como lo dejó la nueva: su pregunta, su respuesta, y el
    // anillo apagado recién cuando contesta ella.
    resolverNueva(respuestaOk("contesto la nueva"));
    expect(await panel.findByText("contesto la nueva")).toBeTruthy();
    await waitFor(() => {
      expect(panel.queryByText(AYUDA_ESPERANDO)).toBeNull();
    });
    expect(panel.getByText("la nueva")).toBeTruthy();
  });

  it("la respuesta que llega con el panel cerrado no reabre nada", async () => {
    let resolver!: (r: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementation(() => new Promise<Response>((res) => (resolver = res)));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<PanelAyuda abierto alCerrar={() => {}} />);
    preguntar(within(screen.getAllByRole("dialog")[0]), "quedo colgada");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(<PanelAyuda abierto={false} alCerrar={() => {}} />);
    await act(async () => {
      resolver(respuestaOk("nadie pidio esto"));
    });

    rerender(<PanelAyuda abierto alCerrar={() => {}} />);
    const reabierta = within(screen.getAllByRole("dialog")[0]);
    await waitFor(() => {
      expect(reabierta.queryByText("nadie pidio esto")).toBeNull();
    });
    expect(reabierta.queryByText("quedo colgada")).toBeNull();
    expect(reabierta.queryByText(AYUDA_ESPERANDO)).toBeNull();
  });
});

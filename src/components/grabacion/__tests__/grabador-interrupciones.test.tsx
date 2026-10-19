// @vitest-environment jsdom
//
// Una grabación es UN MediaRecorder. Estas pruebas cuentan recorders, stops y
// toques: son las que fallaban el 18/9, cuando reanudar tras un corte abría
// un recorder nuevo y pegaba su archivo al anterior.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGrabador, type DatosGrabacion, type EstadoGrabador } from "@/components/grabacion/GrabadorSesion";
import { EN_CURSO, enCurso } from "@/components/grabacion/grabador-tipos";
import { RecorderFalso, recorders } from "./recorder-falso";
import { AVISO_LIMITE_SEGUNDOS, LIMITE_SEGUNDOS } from "@/lib/grabacion-captura";
import { guardarChunk, limpiarGrabacion } from "@/lib/grabacion-storage";
import { MENSAJE_ERROR_GRABADOR } from "@/lib/errores-grabacion";

/** Lo que "quedó en el teléfono". null = no hay nada que recuperar. */
let persistido: {
  sesionClinicaId: string;
  chunks: Blob[];
  mimeType: string;
  duracionAproxSeg: number;
  pausas: { inicio: number; fin: number | null }[];
} | null = null;

vi.mock("@/lib/grabacion-storage", async (original) => ({
  // La de verdad: lleva la cuenta de lo que los dobles de abajo contestan.
  seguimientoDeCopia: (await original<typeof import("@/lib/grabacion-storage")>()).seguimientoDeCopia,
  guardarChunk: vi.fn(async () => true),
  guardarPausas: vi.fn(async () => {}),
  iniciarSesionGrabacion: vi.fn(async () => true),
  limpiarGrabacion: vi.fn(async () => {}),
  recuperarGrabacionPendiente: vi.fn(async () => persistido),
}));

const TURNO = "turno-de-prueba";
let pista: PistaFalsa;
let pedidosDeMicrofono = 0;


class PistaFalsa {
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  stop = vi.fn();
}

/** Corre `segundos` de reloj con un chunk por segundo, como con start(1000). */
async function grabar(segundos: number) {
  for (let t = 0; t < segundos; t += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
      const actual = recorders.at(-1);
      if (actual?.state === "recording") actual.emitirChunk();
    });
  }
}

/** La página no corre: pasa el reloj, y ni timers ni chunks. */
async function congelar(ms: number) {
  await act(async () => { vi.setSystemTime(Date.now() + ms); });
}

function montar() {
  const onListo = vi.fn<(datos: DatosGrabacion) => void>();
  const onError = vi.fn();
  const { result, unmount } = renderHook(() => useGrabador({ claveGrabacion: TURNO, onListo, onError }));
  return { grabador: result, onListo, onError, unmount };
}

async function empezar(grabador: { current: { iniciar: (c: string) => Promise<void> } }, segundos = 20) {
  await act(async () => { await grabador.current.iniciar(TURNO); });
  await grabar(segundos);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T13:00:00.000Z"));
  recorders.length = 0;
  persistido = null;
  pedidosDeMicrofono = 0;
  pista = new PistaFalsa();
  vi.stubGlobal("MediaRecorder", RecorderFalso);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: async () => {
        pedidosDeMicrofono += 1;
        return { getAudioTracks: () => [pista], getTracks: () => [pista] };
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("una grabación es un solo MediaRecorder", () => {
  it("pausar y reanudar, las veces que haga falta, usa pause()/resume() del mismo recorder", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 10);

    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      act(() => grabador.current.pausar());
      expect(grabador.current.estado).toBe("pausado");
      await act(async () => { vi.advanceTimersByTime(60_000); });
      act(() => grabador.current.reanudar());
      expect(grabador.current.estado).toBe("grabando");
      await grabar(10);
    }

    act(() => grabador.current.terminar());

    expect(recorders).toHaveLength(1);
    expect(pedidosDeMicrofono).toBe(1);
    expect(recorders[0].pause).toHaveBeenCalledTimes(3);
    expect(recorders[0].resume).toHaveBeenCalledTimes(3);
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(pista.stop).toHaveBeenCalledTimes(1);
    // 40 s de audio recibido; los tres minutos en pausa no son grabación.
    expect(onListo.mock.calls[0][0].duracionSegundos).toBe(40);
    expect(onListo.mock.calls[0][0].pausas).toHaveLength(3);
  });

  it("un doble toque en Reanudar reanuda una sola vez y no vuelve a pausar", async () => {
    const { grabador } = montar();
    await empezar(grabador, 5);
    act(() => grabador.current.pausar());
    await act(async () => { vi.advanceTimersByTime(5000); });

    act(() => {
      grabador.current.reanudar();
      // El segundo toque cae sobre el botón que ahora dice Pausar.
      grabador.current.reanudar();
      grabador.current.pausar();
    });

    expect(recorders[0].resume).toHaveBeenCalledTimes(1);
    expect(recorders[0].pause).toHaveBeenCalledTimes(1);
    expect(grabador.current.estado).toBe("grabando");
    // Mientras dura la guarda el botón va deshabilitado; después se libera.
    expect(grabador.current.conmutando).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(grabador.current.conmutando).toBe(false);
    expect(recorders).toHaveLength(1);
  });

  it("el micrófono silenciado por una llamada NO detiene el recorder ni suelta el micrófono", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 10);

    act(() => pista.onmute?.());
    await grabar(30);
    expect(grabador.current.estado).toBe("grabando");
    expect(grabador.current.microfonoSilenciado).toBe(true);
    expect(recorders[0].stop).not.toHaveBeenCalled();
    expect(pista.stop).not.toHaveBeenCalled();

    act(() => pista.onunmute?.());
    expect(grabador.current.microfonoSilenciado).toBe(false);
    act(() => grabador.current.terminar());
    expect(recorders).toHaveLength(1);
    expect(onListo.mock.calls[0][0].diagnostico.eventos.map((e) => e.tipo)).toEqual(["mute", "unmute"]);
  });

  it("si la pista terminó, la grabación termina ahí: no se reanuda, sólo se guarda lo grabado", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 15);

    act(() => pista.onended?.());
    expect(grabador.current.estado).toBe("terminada");

    // Reanudar no existe para este estado: no abre otro recorder.
    act(() => grabador.current.reanudar());
    expect(grabador.current.estado).toBe("terminada");
    expect(pedidosDeMicrofono).toBe(1);
    expect(onListo).not.toHaveBeenCalled();

    act(() => grabador.current.terminar());
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
    expect(onListo.mock.calls[0][0].diagnostico.eventos.at(-1)?.tipo).toBe("pista-terminada");
  });

  it("un error del recorder tampoco abre otro: termina y ofrece guardar", async () => {
    const { grabador } = montar();
    await empezar(grabador, 5);
    act(() => recorders[0].onerror?.());
    expect(grabador.current.estado).toBe("terminada");
    expect(recorders).toHaveLength(1);
  });
});

describe("lo grabado se mide por los chunks, no por el reloj", () => {
  it("con el teléfono bloqueado veinte minutos no corta nada, y al volver dice el hueco con sus horas", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 60);
    const desde = Date.now();

    await congelar(20 * 60 * 1000);
    // Al desbloquear vuelven los timers y el audio.
    await grabar(3);

    expect(grabador.current.estado).toBe("grabando");
    expect(recorders[0].stop).not.toHaveBeenCalled();
    expect(recorders[0].pause).not.toHaveBeenCalled();
    expect(grabador.current.segundos).toBe(63);
    // Desde donde termina el audio que sí llegó, hasta que volvió a llegar a ritmo normal.
    expect(grabador.current.hueco).toEqual({ desde: desde + 2000, hasta: desde + 20 * 60 * 1000 + 2000 });

    // El aviso queda hasta que ella lo cierra; después sigue o termina.
    await grabar(30);
    expect(grabador.current.hueco).not.toBeNull();
    act(() => grabador.current.cerrarAvisoHueco());
    expect(grabador.current.hueco).toBeNull();

    act(() => grabador.current.terminar());
    const { duracionSegundos, diagnostico } = onListo.mock.calls[0][0];
    expect(duracionSegundos).toBe(93);
    expect(diagnostico.eventos.map((e) => e.tipo)).toEqual(["hueco-latido", "hueco-chunks"]);
    expect(diagnostico.eventos[1].ms).toBe(20 * 60 * 1000);
  });

  it("si el audio deja de llegar con la pantalla a la vista, lo dice mientras dura y sigue grabando", async () => {
    const { grabador } = montar();
    await empezar(grabador, 10);
    const desde = Date.now();

    await act(async () => { vi.advanceTimersByTime(8000); });

    expect(grabador.current.hueco).toEqual({ desde, hasta: null });
    expect(grabador.current.estado).toBe("grabando");
    expect(recorders[0].stop).not.toHaveBeenCalled();
  });

  it("el tope de 150 minutos se aplica sobre el audio recibido: pausa el MISMO recorder y no sube nada", async () => {
    const { grabador, onListo } = montar();
    await act(async () => { await grabador.current.iniciar(TURNO); });

    // 149 minutos de audio y después 30 de teléfono bloqueado: son 179 de
    // reloj, y NO es el tope.
    await act(async () => {
      for (let t = 0; t < 149 * 60; t += 1) { vi.advanceTimersByTime(1000); recorders[0].emitirChunk(); }
    });
    await congelar(30 * 60 * 1000);
    await grabar(1);
    expect(grabador.current.limiteAlcanzado).toBe(false);
    expect(grabador.current.avisoLimite).toBe(true);
    expect(grabador.current.segundos).toBeGreaterThanOrEqual(AVISO_LIMITE_SEGUNDOS);

    await grabar(60);
    expect(grabador.current.limiteAlcanzado).toBe(true);
    expect(grabador.current.estado).toBe("pausado");
    expect(grabador.current.segundos).toBe(LIMITE_SEGUNDOS);
    expect(recorders[0].pause).toHaveBeenCalledTimes(1);
    expect(recorders[0].stop).not.toHaveBeenCalled();
    expect(onListo).not.toHaveBeenCalled();

    // Pasado el tope no se reanuda: sólo se termina.
    await act(async () => { vi.advanceTimersByTime(2000); });
    act(() => grabador.current.reanudar());
    expect(recorders[0].resume).not.toHaveBeenCalled();
    act(() => grabador.current.terminar());
    expect(onListo.mock.calls[0][0].duracionSegundos).toBe(LIMITE_SEGUNDOS);
    expect(recorders).toHaveLength(1);
  });
});

describe("lo que se entrega", () => {
  it("es un Blob armado con los mismos chunks, con el formato del recorder, sin cifrar ni copiar", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 11);
    act(() => grabador.current.terminar());

    const { audioBlob, diagnostico } = onListo.mock.calls[0][0];
    expect(audioBlob.type).toBe("audio/webm;codecs=opus");
    // 11 chunks + el que entrega stop(), de 5 bytes cada uno.
    expect(audioBlob.size).toBe(60);
    expect(await audioBlob.text()).toBe("a".repeat(60));
    expect(diagnostico).toMatchObject({ chunks: 12, bytes: 60 });
    expect(Object.keys(onListo.mock.calls[0][0]).sort()).toEqual(["audioBlob", "diagnostico", "duracionSegundos", "pausas", "respaldoEnTelefono"]);
    await expect(onListo.mock.calls[0][0].respaldoEnTelefono?.()).resolves.toBe(true);
  });

  it("si un chunk no se pudo guardar en el teléfono (cuota llena), la entrega lo dice", async () => {
    vi.mocked(guardarChunk).mockResolvedValueOnce(false);
    const { grabador, onListo } = montar();
    await empezar(grabador, 11);
    act(() => grabador.current.terminar());

    await expect(onListo.mock.calls[0][0].respaldoEnTelefono?.()).resolves.toBe(false);
  });

  it("una grabación que quedó en el teléfono se envía sin pedir ninguna clave", async () => {
    persistido = { sesionClinicaId: TURNO, chunks: [new Blob(["cabecera"]), new Blob(["+audio"])], mimeType: "audio/webm", duracionAproxSeg: 600, pausas: [] };
    const { grabador, onListo } = montar();
    await act(async () => { await Promise.resolve(); });
    expect(grabador.current.pendienteSeg).toBe(600);

    act(() => grabador.current.enviarPendiente());

    expect(await onListo.mock.calls[0][0].audioBlob.text()).toBe("cabecera+audio");
    expect(onListo.mock.calls[0][0].diagnostico.eventos[0].tipo).toBe("recuperada");
    // No se abrió ningún micrófono ni recorder para enviarla.
    expect(recorders).toHaveLength(0);
  });

  it("descartar la pendiente la borra del teléfono", async () => {
    persistido = { sesionClinicaId: TURNO, chunks: [new Blob(["x"])], mimeType: "audio/webm", duracionAproxSeg: 1, pausas: [] };
    const { grabador } = montar();
    await act(async () => { await Promise.resolve(); });
    act(() => grabador.current.descartarPendiente());
    expect(grabador.current.pendienteSeg).toBeNull();
    expect(limpiarGrabacion).toHaveBeenCalledWith(TURNO);
  });
});

describe("un toque accidental no se sube", () => {
  it("con menos de 10 segundos grabados, Terminar no entrega nada, borra lo guardado y deja volver a grabar", async () => {
    const { grabador, onListo, onError } = montar();
    await empezar(grabador, 3);

    act(() => grabador.current.terminar());

    expect(onListo).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(grabador.current.muyCorta).toBe(true);
    expect(grabador.current.estado).toBe("inactivo");
    expect(grabador.current.segundos).toBe(0);
    expect(limpiarGrabacion).toHaveBeenCalledWith(TURNO);
    // Se soltó el micrófono, y el último trozo que entrega stop() no vuelve a
    // escribirse en el teléfono después de borrar.
    expect(pista.stop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guardarChunk).mock.calls).toHaveLength(3);

    // Mismo turno, otra vez: graba de nuevo (con un recorder nuevo) y esta vez sí entrega.
    await empezar(grabador, 12);
    expect(recorders).toHaveLength(2);
    expect(grabador.current.muyCorta).toBe(false);
    act(() => grabador.current.terminar());
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(onListo.mock.calls[0][0].duracionSegundos).toBe(12);
  });

  it("diez segundos justos sí se suben", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 10);
    act(() => grabador.current.terminar());
    expect(onListo).toHaveBeenCalledTimes(1);
  });

  it("lo que cuenta es el audio grabado, no el reloj: 3 s de audio y un minuto en pausa siguen siendo un toque", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 3);
    act(() => grabador.current.pausar());
    await act(async () => { vi.advanceTimersByTime(60_000); });
    act(() => grabador.current.terminar());
    expect(onListo).not.toHaveBeenCalled();
    expect(grabador.current.muyCorta).toBe(true);
  });

  it("una copia de 2 segundos que quedó en el teléfono tampoco se sube: se borra", async () => {
    persistido = { sesionClinicaId: TURNO, chunks: [new Blob(["x"]), new Blob(["y"])], mimeType: "audio/webm", duracionAproxSeg: 2, pausas: [] };
    const { grabador, onListo } = montar();
    await act(async () => { await Promise.resolve(); });
    act(() => grabador.current.enviarPendiente());
    expect(onListo).not.toHaveBeenCalled();
    expect(grabador.current.muyCorta).toBe(true);
    expect(grabador.current.pendienteSeg).toBeNull();
    expect(limpiarGrabacion).toHaveBeenCalledWith(TURNO);
  });
});

describe("los errores del micrófono se dicen en castellano", () => {
  it("un error del navegador con texto en inglés no llega a la pantalla: va el del catálogo", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: async () => { throw new TypeError("Permission denied by system"); } },
    });
    const consola = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { grabador, onError } = montar();
    await act(async () => { await grabador.current.iniciar(TURNO); });

    expect(grabador.current.estado).toBe("error");
    expect(grabador.current.mensajeError).toBe(MENSAJE_ERROR_GRABADOR["no-inicio"]);
    expect(onError).toHaveBeenCalledWith(MENSAJE_ERROR_GRABADOR["no-inicio"]);
    // El original queda para el diagnóstico, no para ella.
    expect(consola).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: "Permission denied by system" }));
  });

  it("un navegador sin grabación lo dice con el texto del catálogo", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });
    const { grabador } = montar();
    await act(async () => { await grabador.current.iniciar(TURNO); });

    expect(grabador.current.mensajeError).toBe(MENSAJE_ERROR_GRABADOR["sin-soporte"]);
  });
});

describe("caminos de fallo del grabador", () => {
  it("un archivo vacío no se entrega: lo dice y no sube nada", async () => {
    // Llegó a contar diez minutos, pero los chunks no traen bytes.
    persistido = { sesionClinicaId: TURNO, chunks: [new Blob([]), new Blob([])], mimeType: "audio/webm", duracionAproxSeg: 600, pausas: [] };
    const { grabador, onListo, onError } = montar();
    await act(async () => { await Promise.resolve(); });

    act(() => grabador.current.enviarPendiente());

    expect(onListo).not.toHaveBeenCalled();
    expect(grabador.current.estado).toBe("error");
    expect(grabador.current.mensajeError).toBe(MENSAJE_ERROR_GRABADOR.vacia);
    expect(onError).toHaveBeenCalledWith(MENSAJE_ERROR_GRABADOR.vacia);
  });

  it("si stop() lanza al terminar, lo dice y suelta el micrófono", async () => {
    const { grabador, onListo } = montar();
    await empezar(grabador, 12);
    recorders[0].stop.mockImplementationOnce(() => { throw new DOMException("x", "InvalidStateError"); });

    act(() => grabador.current.terminar());

    expect(onListo).not.toHaveBeenCalled();
    expect(grabador.current.estado).toBe("error");
    expect(grabador.current.mensajeError).toBe(MENSAJE_ERROR_GRABADOR["no-se-detuvo"]);
    expect(pista.stop).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Las transiciones del grabador, en una tabla: cada acción desde cada estado.
// Fija las guardas que hoy están en cada función (iniciar, pausar, reanudar,
// terminar, descartar, resetear) contra el diagrama de grabador-tipos.ts.
// "preparando" no entra como origen: con un recorder que entrega al detenerse
// dura lo que tarda onstop, y no hay acción que se pueda tocar en el medio.
// ────────────────────────────────────────────────────────────────────────────

type Accion = "iniciar" | "pausar" | "reanudar" | "terminar" | "descartar" | "resetear";
type Origen = Exclude<EstadoGrabador, "preparando">;

async function llevarA(estado: Origen) {
  const montado = montar();
  const { grabador } = montado;
  if (estado === "inactivo") return montado;
  if (estado === "error") {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("x", "NotAllowedError"); };
    await act(async () => { await grabador.current.iniciar(TURNO); });
    navigator.mediaDevices.getUserMedia = original;
    return montado;
  }
  await empezar(grabador, 12);
  if (estado === "pausado") {
    act(() => grabador.current.pausar());
    await act(async () => { vi.advanceTimersByTime(1000); });
  }
  if (estado === "terminada") act(() => pista.onended?.());
  if (estado === "entregada") act(() => grabador.current.terminar());
  expect(grabador.current.estado).toBe(estado);
  return montado;
}

const TRANSICIONES: Record<Origen, Record<Accion, EstadoGrabador>> = {
  inactivo: { iniciar: "grabando", pausar: "inactivo", reanudar: "inactivo", terminar: "inactivo", descartar: "inactivo", resetear: "inactivo" },
  grabando: { iniciar: "grabando", pausar: "pausado", reanudar: "grabando", terminar: "entregada", descartar: "inactivo", resetear: "inactivo" },
  pausado: { iniciar: "pausado", pausar: "pausado", reanudar: "grabando", terminar: "entregada", descartar: "inactivo", resetear: "inactivo" },
  terminada: { iniciar: "terminada", pausar: "terminada", reanudar: "terminada", terminar: "entregada", descartar: "inactivo", resetear: "inactivo" },
  // Después de un error del micrófono se puede volver a intentar.
  error: { iniciar: "grabando", pausar: "error", reanudar: "error", terminar: "error", descartar: "inactivo", resetear: "inactivo" },
  // Lo entregado ya es de la pantalla: sólo se sale descartando o reseteando.
  entregada: { iniciar: "entregada", pausar: "entregada", reanudar: "entregada", terminar: "entregada", descartar: "inactivo", resetear: "inactivo" },
};

describe("tabla de transiciones del grabador", () => {
  const casos = Object.entries(TRANSICIONES).flatMap(([origen, acciones]) =>
    Object.entries(acciones).map(([accion, destino]) => [origen as Origen, accion as Accion, destino] as const),
  );

  it.each(casos)("%s + %s → %s", async (origen, accion, destino) => {
    const { grabador } = await llevarA(origen);
    await act(async () => {
      if (accion === "iniciar") await grabador.current.iniciar(TURNO);
      else grabador.current[accion]();
    });
    expect(grabador.current.estado).toBe(destino);
  });

  it("EN_CURSO son los estados con una grabación abierta, y enCurso los reconoce", () => {
    expect([...EN_CURSO].sort()).toEqual(["grabando", "pausado", "terminada"]);
    for (const origen of Object.keys(TRANSICIONES) as Origen[]) {
      expect(enCurso(origen)).toBe(EN_CURSO.has(origen));
    }
  });
});

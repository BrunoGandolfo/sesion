// El micrófono: qué se le dice a la profesional cuando falla, y con qué
// formato se graba.
//
// Nunca había tenido tests: estaba adentro de GrabadorSesion.tsx, que no se
// puede renderizar sin jsdom. Con el módulo aparte alcanza un doble del
// global `MediaRecorder`.
//
// Los mensajes de error son lo único que ve alguien parada frente a una
// paciente con el micrófono que no arranca. Que digan lo correcto no es
// cosmética: "no diste permiso" y "cerrá otras apps" mandan a lugares
// distintos.

import { afterEach, describe, expect, it } from "vitest";

import {
  crearMediaRecorder,
  mensajeErrorGrabacion,
} from "@/lib/grabacion-microfono";

const GENERICO = "No se pudo iniciar la grabación de audio.";

describe("mensajeErrorGrabacion", () => {
  it.each([
    ["NotAllowedError", "No diste permiso"],
    ["PermissionDeniedError", "No diste permiso"],
    ["NotFoundError", "No encontramos un micrófono"],
    ["DevicesNotFoundError", "No encontramos un micrófono"],
    ["NotReadableError", "Cerrá otras apps"],
    ["TrackStartError", "Cerrá otras apps"],
    ["SecurityError", "bloqueó la grabación"],
  ])("%s → %s", (nombre, esperado) => {
    // Los pares son el mismo caso con el nombre viejo y el nuevo según el
    // navegador: los dos tienen que dar el MISMO mensaje.
    expect(mensajeErrorGrabacion(new DOMException("x", nombre))).toContain(
      esperado,
    );
  });

  it("un DOMException desconocido cae en el genérico", () => {
    expect(mensajeErrorGrabacion(new DOMException("x", "AbortError"))).toBe(
      GENERICO,
    );
  });

  it("un Error común pasa su mensaje", () => {
    expect(mensajeErrorGrabacion(new Error("el micrófono explotó"))).toBe(
      "el micrófono explotó",
    );
  });

  it("un Error sin mensaje cae en el genérico, no en la cadena vacía", () => {
    expect(mensajeErrorGrabacion(new Error(""))).toBe(GENERICO);
  });

  it("cualquier otra cosa cae en el genérico", () => {
    expect(mensajeErrorGrabacion(null)).toBe(GENERICO);
    expect(mensajeErrorGrabacion("un string suelto")).toBe(GENERICO);
    expect(mensajeErrorGrabacion(undefined)).toBe(GENERICO);
  });
});

// ────────────────────────────────────────────────────────────────────────────

interface Construccion {
  opciones?: { mimeType: string };
}

const construcciones: Construccion[] = [];
const original = globalThis.MediaRecorder;

/**
 * Doble de MediaRecorder. `soportados` decide qué contesta
 * `isTypeSupported`; `explotaCon` hace que el constructor tire para un
 * mimeType puntual (pasa de verdad: hay navegadores que dicen que sí y
 * después no pueden).
 */
function mediaRecorderFalso(opciones: {
  /** Lista de mimeTypes que acepta, o null para no exponer isTypeSupported. */
  soportados: string[] | null;
  explotaCon?: string;
}) {
  const { soportados, explotaCon } = opciones;

  class MediaRecorderFalso {
    constructor(
      readonly stream: MediaStream,
      readonly opciones?: { mimeType: string },
    ) {
      construcciones.push({ opciones });
      if (explotaCon && opciones?.mimeType === explotaCon) {
        throw new Error("no soportado de verdad");
      }
    }
  }

  const clase = MediaRecorderFalso as unknown as {
    isTypeSupported?: (tipo: string) => boolean;
  };

  // `null` simula un navegador viejo que no expone isTypeSupported: el
  // grabador tiene que probar el constructor igual, no rendirse.
  if (soportados !== null) {
    clase.isTypeSupported = (tipo: string) => soportados.includes(tipo);
  }

  return MediaRecorderFalso as unknown as typeof MediaRecorder;
}

const streamFalso = {} as MediaStream;

afterEach(() => {
  construcciones.length = 0;
  globalThis.MediaRecorder = original;
});

describe("crearMediaRecorder", () => {
  it("prefiere opus si el navegador lo soporta", () => {
    globalThis.MediaRecorder = mediaRecorderFalso({
      soportados: ["audio/webm;codecs=opus", "audio/webm"],
    });

    crearMediaRecorder(streamFalso);

    expect(construcciones).toHaveLength(1);
    expect(construcciones[0].opciones).toEqual({
      mimeType: "audio/webm;codecs=opus",
    });
  });

  it("baja a webm a secas si opus no está", () => {
    globalThis.MediaRecorder = mediaRecorderFalso({
      soportados: ["audio/webm"],
    });

    crearMediaRecorder(streamFalso);

    expect(construcciones[0].opciones).toEqual({ mimeType: "audio/webm" });
  });

  it("sin ningún formato soportado construye sin opciones: que elija el navegador", () => {
    // Es el caso de Safari. Preferimos grabar en el formato que sea a no
    // grabar.
    globalThis.MediaRecorder = mediaRecorderFalso({ soportados: [] });

    crearMediaRecorder(streamFalso);

    expect(construcciones).toHaveLength(1);
    expect(construcciones[0].opciones).toBeUndefined();
  });

  it("si el constructor explota con un formato, sigue con el siguiente", () => {
    // isTypeSupported dice que sí y el constructor tira igual: pasa.
    globalThis.MediaRecorder = mediaRecorderFalso({
      soportados: ["audio/webm;codecs=opus", "audio/webm"],
      explotaCon: "audio/webm;codecs=opus",
    });

    crearMediaRecorder(streamFalso);

    expect(construcciones.map((c) => c.opciones?.mimeType)).toEqual([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  });

  it("sin isTypeSupported prueba igual el primero", () => {
    globalThis.MediaRecorder = mediaRecorderFalso({ soportados: null });

    crearMediaRecorder(streamFalso);

    expect(construcciones[0].opciones).toEqual({
      mimeType: "audio/webm;codecs=opus",
    });
  });
});

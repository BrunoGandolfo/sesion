// El micrófono: con qué formato se graba. Lo que se le dice cuando falla se
// prueba con su catálogo (src/lib/__tests__/errores-grabacion.test.ts).
//
// Nunca había tenido tests: estaba adentro de GrabadorSesion.tsx, que no se
// puede renderizar sin jsdom. Con el módulo aparte alcanza un doble del
// global `MediaRecorder`.

import { afterEach, describe, expect, it } from "vitest";

import { crearMediaRecorder } from "@/lib/grabacion-microfono";

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

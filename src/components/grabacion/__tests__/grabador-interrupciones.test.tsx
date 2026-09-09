// @vitest-environment jsdom
//
// La prueba de que ninguna interrupción sube nada sola.
//
// `grabacion-captura.test.ts` prueba las reglas; este archivo prueba que el
// hook las OBEDECE, que es donde falló el 7/9: la regla "al llegar al tope,
// cortar" existía, y el latido la implementaba llamando a `terminar`. Las dos
// piezas estaban bien por separado.
//
// Por eso el assert que se repite en los cinco casos es siempre el mismo:
// `onListo` no se llamó. Es la única firma que distingue "se pausó" de "se
// subió", y es lo que la profesional vio pasar sin haberlo pedido.
//
// EL DOBLE DEL MICRÓFONO
//
// No hay AudioContext a propósito: en jsdom no existe, y el grabador ya
// degrada a "sin medidor" cuando falta. Eso deja la detección de silencio
// apoyada en el otro reloj —la sequía de chunks del MediaRecorder—, que es
// justamente el que funciona con la pantalla apagada y el que este archivo
// necesita ejercitar. Emitir un chunk es la forma de decir "entra audio".

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGrabador } from "@/components/grabacion/GrabadorSesion";

// IndexedDB no existe en jsdom, así que el backup real degrada a no-op y la
// vuelta de bfcache no tendría de dónde releer nada. Se dobla el módulo
// entero: lo que importa acá es qué hace el grabador con lo que le devuelven.
vi.mock("@/lib/grabacion-storage", () => ({
  guardarChunk: vi.fn(async () => {}),
  guardarPausas: vi.fn(async () => {}),
  iniciarSesionGrabacion: vi.fn(async () => {}),
  limpiarGrabacion: vi.fn(async () => {}),
  recuperarGrabacionPendiente: vi.fn(async () => persistido),
}));

/** Lo que "quedó en el teléfono". null = no hay nada que recuperar. */
let persistido: {
  sesionClinicaId: string;
  chunks: Blob[];
  duracionAproxSeg: number;
  pausas: { inicio: number; fin: number | null }[];
} | null = null;
import {
  LIMITE_SEGUNDOS,
  AVISO_LIMITE_SEGUNDOS,
  SILENCIO_OCULTA_INTERRUMPIR_SEG,
  SILENCIO_VISIBLE_INTERRUMPIR_SEG,
} from "@/lib/grabacion-captura";

const CLAVE = "turno-de-prueba";

/** El MediaRecorder falso vivo del test: por acá se emiten los chunks. */
let recorderActivo: RecorderFalso | null = null;

class RecorderFalso {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    // Se pasa como argumento en vez de `recorderActivo = this`: aliasear
    // `this` a una variable es justo lo que prohíbe no-this-alias.
    RecorderFalso.registrar(this);
  }

  static registrar(instancia: RecorderFalso) {
    recorderActivo = instancia;
  }

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  /** Cuando está en true, `stop()` no dispara el onstop hasta que se llame
   *  a `soltarOnstop()`. Es la única forma de reproducir el orden real: el
   *  navegador decide cuándo entrega el onstop, y puede ser después del
   *  pageshow. */
  retenerOnstop = false;
  private onstopRetenido = false;

  stop() {
    this.state = "inactive";
    if (this.retenerOnstop) {
      this.onstopRetenido = true;
      return;
    }
    this.onstop?.();
  }

  soltarOnstop() {
    if (!this.onstopRetenido) return;
    this.onstopRetenido = false;
    this.onstop?.();
  }

  /** Un segundo de audio entrando. */
  emitirChunk() {
    this.ondataavailable?.({ data: new Blob(["audio"]) });
  }

  static isTypeSupported() {
    return true;
  }
}

function pistaFalsa() {
  return { stop: () => {}, onended: null, onmute: null, onunmute: null };
}

function verVisibilidad(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

/**
 * Deja correr `segundos` de reloj emitiendo un chunk cada `cadaSegundos`.
 * `cadaSegundos = null` es el corte: pasa el tiempo y no entra nada.
 */
async function correr(segundos: number, cadaSegundos: number | null = 1) {
  const paso = cadaSegundos ?? 30;

  for (let t = 0; t < segundos; t += paso) {
    await act(async () => {
      vi.advanceTimersByTime(paso * 1000);
      if (cadaSegundos !== null) {
        recorderActivo?.emitirChunk();
      }
    });
  }
}

async function grabarUnRato(hook: { current: { iniciar: (c: string) => Promise<void> } }) {
  await act(async () => {
    await hook.current.iniciar(CLAVE);
  });
  await correr(20);
}

function montar() {
  const onListo = vi.fn();
  const onError = vi.fn();
  const { result } = renderHook(() =>
    useGrabador({ claveGrabacion: CLAVE, onListo, onError }),
  );
  return { grabador: result, onListo, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  recorderActivo = null;
  persistido = null;
  verVisibilidad("visible");

  vi.stubGlobal("MediaRecorder", RecorderFalso);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [pistaFalsa()],
        getTracks: () => [pistaFalsa()],
      }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la pantalla se bloquea a mitad de sesión", () => {
  it("al minuto sin audio pausa la grabación y NO sube nada", async () => {
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);
    expect(grabador.current.estado).toBe("grabando");

    // El celular se bloquea: la pista sigue "viva" (no emite ended ni mute),
    // simplemente deja de entrar audio. Es exactamente el 7/9.
    verVisibilidad("hidden");
    await correr(SILENCIO_OCULTA_INTERRUMPIR_SEG + 5, null);

    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.motivoInterrupcion).toBe("sin-sonido");
    expect(onListo).not.toHaveBeenCalled();
  });

  it("lo grabado antes del corte sigue ahí, esperando decisión", async () => {
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);
    const segundosAntes = grabador.current.segundos;
    expect(segundosAntes).toBeGreaterThan(0);

    verVisibilidad("hidden");
    await correr(SILENCIO_OCULTA_INTERRUMPIR_SEG + 5, null);

    // El cronómetro no siguió corriendo durante el corte: la interrupción
    // abre una pausa, y el tiempo sin micrófono no es tiempo grabado.
    expect(grabador.current.segundos).toBeLessThanOrEqual(segundosAntes + 2);
    expect(onListo).not.toHaveBeenCalled();

    // Y terminar sigue siendo un acto suyo, no del reloj: recién con su toque
    // arranca el cifrado. (No se espera a que termine: `cifrarGrabacion` pide
    // Web Crypto de verdad, que jsdom no trae. Que salga de "interrumpida" es
    // lo que este test tiene que ver.)
    act(() => {
      grabador.current.terminar();
    });
    expect(grabador.current.estado).toBe("cifrando");
  });

  it("con la pantalla a la vista aguanta mucho más antes de cortar", async () => {
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);

    // Dos minutos de silencio en sesión son trabajo, no una falla: avisa.
    await correr(150, null);
    expect(grabador.current.estado).toBe("grabando");
    expect(grabador.current.audioSilencioso).toBe(true);

    // A los cinco sí corta, y tampoco sube nada.
    await correr(SILENCIO_VISIBLE_INTERRUMPIR_SEG, null);
    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.motivoInterrupcion).toBe("sin-sonido");
    expect(onListo).not.toHaveBeenCalled();
  });

  it("mientras entra audio no corta nunca, ni oculta", async () => {
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);
    verVisibilidad("hidden");
    await correr(600, 1);

    expect(grabador.current.estado).toBe("grabando");
    expect(onListo).not.toHaveBeenCalled();
  });
});

describe("el tope de duración", () => {
  it("avisa a los 135 minutos y corta a los 150 sin subir nada", async () => {
    const { grabador, onListo } = montar();

    await act(async () => {
      await grabador.current.iniciar(CLAVE);
    });

    // Sesión larga con audio entrando todo el tiempo: el único corte posible
    // es el del tope.
    await correr(AVISO_LIMITE_SEGUNDOS + 60, 30);

    expect(grabador.current.estado).toBe("grabando");
    expect(grabador.current.avisoLimite).toBe(true);
    expect(onListo).not.toHaveBeenCalled();

    await correr(LIMITE_SEGUNDOS - AVISO_LIMITE_SEGUNDOS, 30);

    // Lo que antes cifraba y subía. Ahora espera.
    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.motivoInterrupcion).toBe("limite");
    expect(grabador.current.limiteAlcanzado).toBe(true);
    expect(grabador.current.segundos).toBe(LIMITE_SEGUNDOS);
    expect(onListo).not.toHaveBeenCalled();
  });

  it("una sesión de 120 minutos ya no se corta: es el caso del 7/9", async () => {
    const { grabador, onListo } = montar();

    await act(async () => {
      await grabador.current.iniciar(CLAVE);
    });
    await correr(120 * 60, 30);

    expect(grabador.current.estado).toBe("grabando");
    expect(grabador.current.avisoLimite).toBe(false);
    expect(onListo).not.toHaveBeenCalled();
  });
});

describe("el aviso de la pantalla apagada", () => {
  it("no se enciende cuando el navegador no tiene wake lock", async () => {
    // navigator.wakeLock no existe en el doble: el grabador marca
    // `wakeLockActivo` en false, pero eso NO es "se apagó la pantalla".
    // Decírselo sería mandarla a resolver un problema que no tiene.
    const { grabador } = montar();

    await grabarUnRato(grabador);

    expect(grabador.current.wakeLockActivo).toBe(false);
    expect(grabador.current.wakeLockSoltado).toBe(false);
  });
});

describe("la pantalla se apaga y el navegador descarga la página", () => {
  it("al volver de bfcache recupera lo grabado y queda en pausa", async () => {
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);
    expect(grabador.current.estado).toBe("grabando");

    // Lo que el backup incremental venía guardando mientras grababa.
    persistido = {
      sesionClinicaId: CLAVE,
      chunks: [new Blob(["a"]), new Blob(["b"]), new Blob(["c"])],
      duracionAproxSeg: 20,
      pausas: [],
    };

    // `pagehide` tira la RAM porque el proceso puede morir. Antes esto dejaba
    // la grabación muerta en la pantalla previa: el efecto de recuperación
    // depende de `claveGrabacion` y volver de bfcache no remonta nada.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(grabador.current.estado).toBe("inactivo");

    const vuelta = new Event("pageshow");
    Object.defineProperty(vuelta, "persisted", { value: true });

    await act(async () => {
      window.dispatchEvent(vuelta);
    });

    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.motivoInterrupcion).toBe("pantalla");
    expect(grabador.current.segundos).toBe(20);
    expect(onListo).not.toHaveBeenCalled();
  });

  it("desde 'interrumpida' la vuelta la deja como estaba, no la borra", async () => {
    // P1 de Codex (a): `pagehide` solo levantaba la bandera para grabando y
    // pausado. Con la grabación ya interrumpida —el micrófono se cortó y ella
    // todavía no decidió— la bandera quedaba en false y detenerActiva sin
    // recorder la mandaba a "inactivo": al volver, la grabación y sus dos
    // botones habían desaparecido de la pantalla.
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);

    verVisibilidad("hidden");
    await correr(SILENCIO_OCULTA_INTERRUMPIR_SEG + 5, null);
    expect(grabador.current.estado).toBe("interrumpida");

    const segundosAntes = grabador.current.segundos;

    persistido = {
      sesionClinicaId: CLAVE,
      chunks: [new Blob(["a"]), new Blob(["b"])],
      duracionAproxSeg: segundosAntes,
      pausas: [],
    };

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    // Nada que detener: sigue interrumpida, no pasa por "inactivo".
    expect(grabador.current.estado).toBe("interrumpida");

    const vuelta = new Event("pageshow");
    Object.defineProperty(vuelta, "persisted", { value: true });

    await act(async () => {
      window.dispatchEvent(vuelta);
    });

    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.segundos).toBe(segundosAntes);
    expect(onListo).not.toHaveBeenCalled();

    // Y sigue siendo suya la decisión.
    act(() => {
      grabador.current.terminar();
    });
    expect(grabador.current.estado).toBe("cifrando");
  });

  it("aguanta que pageshow llegue antes que el onstop del recorder", async () => {
    // P1 de Codex (b): `recorder.stop()` deja el estado en "inactivo" recién
    // en `onstop`, un turno después. Si `pageshow` llegaba en el medio, la
    // guarda veía "grabando", se retiraba, y nadie reintentaba nunca.
    //
    // El doble retiene el onstop para forzar ese orden, que en un teléfono
    // decide el navegador y no nosotros.
    const { grabador, onListo } = montar();

    await grabarUnRato(grabador);
    persistido = {
      sesionClinicaId: CLAVE,
      chunks: [new Blob(["a"]), new Blob(["b"]), new Blob(["c"])],
      duracionAproxSeg: 20,
      pausas: [],
    };

    const recorder = recorderActivo;
    if (!recorder) throw new Error("no hay recorder");
    recorder.retenerOnstop = true;

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    // El stop salió pero el onstop todavía no llegó: sigue "grabando".
    expect(recorder.state).toBe("inactive");
    expect(grabador.current.estado).toBe("grabando");

    const vuelta = new Event("pageshow");
    Object.defineProperty(vuelta, "persisted", { value: true });

    await act(async () => {
      window.dispatchEvent(vuelta);
    });

    // Todavía no puede restaurar, pero tampoco se rindió: quedó anotada.
    expect(grabador.current.estado).toBe("grabando");

    await act(async () => {
      recorder.soltarOnstop();
    });

    expect(grabador.current.estado).toBe("interrumpida");
    expect(grabador.current.motivoInterrupcion).toBe("pantalla");
    expect(grabador.current.segundos).toBe(20);
    expect(onListo).not.toHaveBeenCalled();
  });

  it("una carga nueva (sin persisted) no resucita nada por su cuenta", async () => {
    // Ahí no hubo bfcache: de esa recuperación se encarga el efecto de
    // montaje, que se la OFRECE en la pantalla previa en vez de reabrirla.
    const { grabador } = montar();

    await grabarUnRato(grabador);
    persistido = {
      sesionClinicaId: CLAVE,
      chunks: [new Blob(["a"])],
      duracionAproxSeg: 20,
      pausas: [],
    };

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(grabador.current.estado).toBe("inactivo");
  });

  it("no resucita una grabación que ella descartó", async () => {
    const { grabador } = montar();

    await grabarUnRato(grabador);

    await act(async () => {
      grabador.current.descartar();
    });
    expect(grabador.current.estado).toBe("inactivo");

    persistido = {
      sesionClinicaId: CLAVE,
      chunks: [new Blob(["a"])],
      duracionAproxSeg: 20,
      pausas: [],
    };

    const vuelta = new Event("pageshow");
    Object.defineProperty(vuelta, "persisted", { value: true });

    await act(async () => {
      window.dispatchEvent(vuelta);
    });

    // `pagehide` nunca corrió con captura viva: no hay nada que restaurar.
    expect(grabador.current.estado).toBe("inactivo");
  });
});

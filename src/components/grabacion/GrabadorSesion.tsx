"use client";

// Máquina de estados de la grabación clínica. SIN UI.
//
// Antes este archivo era 1.249 líneas: la lógica de captura convivía con una
// tarjeta que explicaba el cifrado, mostraba el id del turno y pedía dos
// toques ("Detener" y después "Enviar") para mandar el audio. La capa visual
// se mudó a la ruta /grabar/[turnoId]; acá queda solo lo que no se relaja:
//
//   - captura por chunks de 1 s que forman UN único archivo (la pausa usa
//     MediaRecorder.pause(), no un recorder nuevo);
//   - backup incremental en IndexedDB (grabacion-storage) desde el primer
//     chunk, para sobrevivir a que el navegador mate el proceso;
//   - cifrado AES-GCM con clave generada en el dispositivo ANTES de que el
//     audio salga del navegador;
//   - recuperación de una grabación huérfana del mismo turno;
//   - wake lock mientras se graba y corte por LIMITE_SEGUNDOS.
//
// El consumidor recibe el audio ya cifrado por `onListo` y se encarga de
// subirlo. Acá no hay fetch ni conocimiento de la API.

import * as React from "react";

import { cifrar, generarClave } from "@/lib/crypto";
import {
  guardarChunk,
  guardarPausas,
  iniciarSesionGrabacion,
  limpiarGrabacion,
  recuperarGrabacionPendiente,
  type Pausa,
} from "@/lib/grabacion-storage";

export type { Pausa };

/**
 * Estados y transiciones:
 *
 *   inactivo    → grabando        (iniciar)
 *   grabando    → pausado         (pausar)
 *   pausado     → grabando        (reanudar)
 *   grabando    → interrumpida    (el micrófono murió o quedó muteado 3 s)
 *   pausado     → interrumpida    (idem)
 *   interrumpida→ grabando        (reanudarTrasInterrupcion)
 *   grabando    → cifrando        (terminar, o corte por LIMITE_SEGUNDOS)
 *   pausado     → cifrando        (terminar)
 *   interrumpida→ cifrando        (terminar: usa lo grabado hasta ahí)
 *   inactivo    → cifrando        (enviarPendiente: grabación recuperada)
 *   cifrando    → entregada       (onListo con el audio ya cifrado)
 *   cifrando    → error           (falló el cifrado; los chunks NO se borran)
 *   grabando/pausado/interrumpida → inactivo  (descartar)
 *   error       → inactivo        (resetear)
 */
export type EstadoGrabador =
  | "inactivo"
  | "grabando"
  | "pausado"
  | "interrumpida"
  | "cifrando"
  | "entregada"
  | "error";

/** Pausa cerrada, en ISO, tal como viaja con la sesión. */
export interface PausaRegistrada {
  inicio: string;
  fin: string;
}

export interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
  /** Tramos en los que la grabación estuvo pausada. */
  pausas: PausaRegistrada[];
}

export interface GrabacionPendienteUI {
  chunks: Blob[];
  duracionAproxSeg: number;
  pausas: Pausa[];
}

// "pausar" = detención que preserva los chunks (pausa manual no la usa: ahí
// el recorder sigue vivo). Solo la interrupción del micrófono llega acá.
type ModoDetencion = "completar" | "descartar" | "pausar";

// Safety net por tamaño máximo de upload. WhisperX no tiene límite práctico
// de duración; el corte por timer es solo para evitar archivos enormes.
export const LIMITE_SEGUNDOS = 5400;

// Si el track de audio queda muteado más de este tiempo (Android le quitó el
// micrófono a Chrome por una llamada, etc.), lo tratamos como interrupción.
const MUTE_INTERRUPCION_MS = 3000;

// Cada cuánto se refrescan cronómetro y nivel de audio.
const LATIDO_MS = 250;

// Debajo de este RMS (0-1) consideramos que no entra audio.
const UMBRAL_SILENCIO = 0.012;

// Silencio continuo a partir del cual se avisa "no se detecta audio".
const SILENCIO_AVISO_MS = 5000;

/** "07:32". Exportada porque la pantalla muestra el mismo formato. */
export function formatearDuracion(totalSegundos: number) {
  const minutos = Math.floor(totalSegundos / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (totalSegundos % 60).toString().padStart(2, "0");
  return `${minutos}:${segundos}`;
}

/**
 * Segundos efectivamente grabados. Función pura: es la única fuente de
 * verdad del cronómetro y lo que se testea.
 *
 * `inicio` es el epoch del arranque de la grabación; `pausas` son los tramos
 * detenidos (una pausa con `fin` en null se considera abierta hasta `ahora`).
 * `baseSegundos` suma lo que ya venía grabado de una recuperación.
 *
 * Las pausas se asumen disjuntas y dentro de [inicio, ahora]; así las produce
 * el grabador (nunca hay dos abiertas a la vez). Los tramos que caen fuera de
 * la ventana se recortan.
 */
export function segundosGrabados(
  inicio: number | null,
  ahora: number,
  pausas: readonly Pausa[] = [],
  baseSegundos = 0,
): number {
  const base = Math.max(0, Math.floor(baseSegundos));

  if (inicio === null) {
    return base;
  }

  const fin = Math.max(inicio, ahora);
  let pausadoMs = 0;

  for (const pausa of pausas) {
    const desde = Math.max(pausa.inicio, inicio);
    const hasta = Math.min(pausa.fin ?? fin, fin);

    if (hasta > desde) {
      pausadoMs += hasta - desde;
    }
  }

  const activoMs = Math.max(0, fin - inicio - pausadoMs);

  return base + Math.floor(activoMs / 1000);
}

function base64ABytes(base64: string) {
  const binario = globalThis.atob(base64);
  const bytes = new Uint8Array(binario.length);

  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }

  return bytes;
}

function mensajeErrorGrabacion(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "No diste permiso para usar el micrófono. Habilitalo y probá de nuevo.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No encontramos un micrófono disponible en este dispositivo.";
      case "NotReadableError":
      case "TrackStartError":
        return "No pudimos acceder al micrófono. Cerrá otras apps que lo estén usando y probá de nuevo.";
      case "SecurityError":
        return "Tu navegador bloqueó la grabación de audio en este contexto.";
      default:
        return "No se pudo iniciar la grabación de audio.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "No se pudo iniciar la grabación de audio.";
}

function crearMediaRecorder(stream: MediaStream) {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm"];

  for (const mimeType of mimeTypes) {
    try {
      if (
        typeof MediaRecorder.isTypeSupported === "function" &&
        !MediaRecorder.isTypeSupported(mimeType)
      ) {
        continue;
      }

      return new MediaRecorder(stream, { mimeType });
    } catch {
      continue;
    }
  }

  return new MediaRecorder(stream);
}

function aRegistradas(pausas: readonly Pausa[]): PausaRegistrada[] {
  const cerradas: PausaRegistrada[] = [];

  for (const pausa of pausas) {
    if (pausa.fin === null) continue;
    cerradas.push({
      inicio: new Date(pausa.inicio).toISOString(),
      fin: new Date(pausa.fin).toISOString(),
    });
  }

  return cerradas;
}

export interface UseGrabadorOpciones {
  /** Clave con la que se persisten los chunks: el turnoId (turno ↔ sesión
   *  clínica es 1:1). Null mientras el turno todavía no existe. */
  claveGrabacion: string | null;
  /** Recibe el audio ya cifrado. Se llama una sola vez por grabación. */
  onListo: (datos: DatosGrabacion) => void;
  onError: (mensaje: string) => void;
}

export interface Grabador {
  estado: EstadoGrabador;
  /** Segundos efectivamente grabados (las pausas no cuentan). */
  segundos: number;
  /** 0-1, para el medidor. */
  nivelAudio: number;
  /** true cuando el nivel viene en cero desde hace 5 s grabando. */
  audioSilencioso: boolean;
  wakeLockActivo: boolean;
  mensajeError: string | null;
  limiteAlcanzado: boolean;
  /** Grabación huérfana del mismo turno encontrada en IndexedDB. */
  pendiente: GrabacionPendienteUI | null;
  /** Pausas cerradas de la grabación en curso, en ISO. */
  pausas: PausaRegistrada[];
  iniciar: (clave: string) => Promise<void>;
  pausar: () => void;
  reanudar: () => void;
  terminar: () => void;
  descartar: () => void;
  reanudarTrasInterrupcion: () => Promise<void>;
  enviarPendiente: () => void;
  descartarPendiente: () => void;
  resetear: () => void;
}

export function useGrabador({
  claveGrabacion,
  onListo,
  onError,
}: UseGrabadorOpciones): Grabador {
  const [estado, setEstado] = React.useState<EstadoGrabador>("inactivo");
  const [segundos, setSegundos] = React.useState(0);
  const [nivelAudio, setNivelAudio] = React.useState(0);
  const [audioSilencioso, setAudioSilencioso] = React.useState(false);
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = React.useState(false);
  const [pendiente, setPendiente] =
    React.useState<GrabacionPendienteUI | null>(null);
  const [pausas, setPausas] = React.useState<PausaRegistrada[]>([]);
  // false cuando el navegador no soporta wake lock, el request rechazó o el SO
  // lo soltó (evento "release").
  const [wakeLockActivo, setWakeLockActivo] = React.useState(true);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const chunkIndiceRef = React.useRef(0);
  const inicioGrabacionRef = React.useRef<number | null>(null);
  const pausasRef = React.useRef<Pausa[]>([]);
  // Segundos que ya venían grabados (recuperación desde IndexedDB).
  const baseSegundosRef = React.useRef(0);
  const intervaloRef = React.useRef<number | null>(null);
  const muteTimeoutRef = React.useRef<number | null>(null);
  const silencioDesdeRef = React.useRef<number | null>(null);
  const mimeTypeRef = React.useRef("audio/webm");
  const modoDetencionRef = React.useRef<ModoDetencion>("descartar");
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analizadorRef = React.useRef<AnalyserNode | null>(null);
  const muestraRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);
  const wakeLockReleaseHandlerRef = React.useRef<(() => void) | null>(null);
  const estadoRef = React.useRef<EstadoGrabador>("inactivo");
  const componenteMontadoRef = React.useRef(true);
  const claveRef = React.useRef<string | null>(claveGrabacion);
  const onErrorRef = React.useRef(onError);
  const onListoRef = React.useRef(onListo);
  const detenerActivaRef = React.useRef<(modo: ModoDetencion) => void>(() => {});
  const manejarInterrupcionRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    onErrorRef.current = onError;
    onListoRef.current = onListo;
  }, [onError, onListo]);

  React.useEffect(() => {
    // Solo se adopta la clave del prop mientras no hay grabación en curso: si
    // el padre re-renderiza con otro turno a mitad de captura, los chunks ya
    // persistidos siguen bajo la clave con la que se abrió.
    if (estadoRef.current === "inactivo" && claveGrabacion) {
      claveRef.current = claveGrabacion;
    }
  }, [claveGrabacion]);

  function cambiarEstado(nuevo: EstadoGrabador) {
    estadoRef.current = nuevo;

    if (componenteMontadoRef.current) {
      setEstado(nuevo);
    }
  }

  // Las cinco funciones de limpieza (estas cuatro más limpiarMemoria) van en
  // useCallback por la misma razón que las de wake lock: el efecto de
  // desmontaje las llama en su cleanup y tiene que declararlas como
  // dependencia. Solo tocan refs, así que sus dependencias son vacías y la
  // identidad no cambia nunca: el efecto sigue corriendo una sola vez.
  const limpiarLatido = React.useCallback(() => {
    if (intervaloRef.current !== null) {
      window.clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
  }, []);

  const limpiarMuteTimeout = React.useCallback(() => {
    if (muteTimeoutRef.current !== null) {
      window.clearTimeout(muteTimeoutRef.current);
      muteTimeoutRef.current = null;
    }
  }, []);

  const liberarAnalisis = React.useCallback(() => {
    analizadorRef.current = null;
    muestraRef.current = null;
    silencioDesdeRef.current = null;

    const contexto = audioContextRef.current;
    audioContextRef.current = null;

    if (contexto) {
      void contexto.close().catch(() => {
        // Ya estaba cerrado; el medidor no es crítico.
      });
    }
  }, []);

  const liberarStream = React.useCallback(() => {
    liberarAnalisis();

    if (!streamRef.current) {
      return;
    }

    for (const track of streamRef.current.getTracks()) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    }

    streamRef.current = null;
  }, [liberarAnalisis]);

  // marcarWakeLock / adquirirWakeLock / liberarWakeLock van en useCallback
  // porque los efectos de montaje y de visibilitychange los usan y los
  // declaran como dependencia: solo tocan refs y un setState, así que son
  // estables entre renders.
  const marcarWakeLock = React.useCallback((activo: boolean) => {
    if (componenteMontadoRef.current) {
      setWakeLockActivo(activo);
    }
  }, []);

  const adquirirWakeLock = React.useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator) ||
      !navigator.wakeLock
    ) {
      marcarWakeLock(false);
      return;
    }

    // Idempotente: si ya hay un lock vivo, no pedimos otro.
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      return;
    }

    try {
      const lock = await navigator.wakeLock.request("screen");

      // Mientras esperábamos, la grabación pudo terminar o el componente
      // desmontarse: no nos quedamos con un lock que nadie va a liberar.
      if (
        !componenteMontadoRef.current ||
        (estadoRef.current !== "grabando" && estadoRef.current !== "pausado")
      ) {
        void lock.release().catch(() => {});
        return;
      }

      const onRelease = () => {
        // El SO lo soltó (pantalla bloqueada, cambio de app, batería baja).
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
          wakeLockReleaseHandlerRef.current = null;
        }
        marcarWakeLock(false);
      };

      lock.addEventListener("release", onRelease);
      wakeLockRef.current = lock;
      wakeLockReleaseHandlerRef.current = onRelease;
      marcarWakeLock(true);
    } catch (error) {
      // No es fatal: la grabación sigue, solo perdemos la pantalla encendida.
      console.warn("[useGrabador] No se pudo adquirir el wake lock", error);
      marcarWakeLock(false);
    }
  }, [marcarWakeLock]);

  const liberarWakeLock = React.useCallback(() => {
    const lock = wakeLockRef.current;
    const handler = wakeLockReleaseHandlerRef.current;
    wakeLockRef.current = null;
    wakeLockReleaseHandlerRef.current = null;

    if (lock) {
      // Quitamos el listener antes de liberar: una liberación a propósito no
      // debe disparar el aviso de "mantené la pantalla encendida".
      if (handler) {
        lock.removeEventListener("release", handler);
      }

      void lock.release().catch(() => {
        // El lock ya pudo haberse liberado solo (pantalla bloqueada).
      });
    }

    // Estado neutral hasta el próximo request; evita que un aviso viejo
    // parpadee al arrancar/reanudar antes de que el request resuelva.
    marcarWakeLock(true);
  }, [marcarWakeLock]);

  function calcularSegundos() {
    return segundosGrabados(
      inicioGrabacionRef.current,
      Date.now(),
      pausasRef.current,
      baseSegundosRef.current,
    );
  }

  function publicarPausas() {
    const registradas = aRegistradas(pausasRef.current);

    if (componenteMontadoRef.current) {
      setPausas(registradas);
    }

    const clave = claveRef.current;

    if (clave) {
      // Fire-and-forget, igual que los chunks: el backup nunca bloquea.
      void guardarPausas(clave, pausasRef.current);
    }
  }

  function abrirPausa() {
    pausasRef.current = [...pausasRef.current, { inicio: Date.now(), fin: null }];
    publicarPausas();
  }

  function cerrarPausa() {
    const abierta = pausasRef.current[pausasRef.current.length - 1];

    if (!abierta || abierta.fin !== null) {
      return;
    }

    pausasRef.current = [
      ...pausasRef.current.slice(0, -1),
      { inicio: abierta.inicio, fin: Date.now() },
    ];
    publicarPausas();
  }

  const limpiarMemoria = React.useCallback(() => {
    chunksRef.current = [];
    chunkIndiceRef.current = 0;
    inicioGrabacionRef.current = null;
    pausasRef.current = [];
    baseSegundosRef.current = 0;
    modoDetencionRef.current = "descartar";
    mediaRecorderRef.current = null;
  }, []);

  // OJO: irAError NO borra los chunks persistidos en IndexedDB — si el
  // cifrado falla, esa copia es la única que queda y se puede recuperar.
  function irAError(mensaje: string) {
    limpiarLatido();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setSegundos(0);
      setNivelAudio(0);
      setAudioSilencioso(false);
      setPausas([]);
      setMensajeError(mensaje);
    }

    cambiarEstado("error");
    onErrorRef.current(mensaje);
  }

  function volverAInactivo() {
    limpiarLatido();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setSegundos(0);
      setNivelAudio(0);
      setAudioSilencioso(false);
      setPausas([]);
      setMensajeError(null);
      setLimiteAlcanzado(false);
    }

    cambiarEstado("inactivo");
  }

  async function procesarGrabacion(mimeType: string) {
    // La pausa abierta (por interrupción) se cierra antes de medir: lo que se
    // envía es tiempo grabado, no tiempo transcurrido.
    cerrarPausa();

    const duracionSegundos = Math.max(1, calcularSegundos());
    const pausasFinales = aRegistradas(pausasRef.current);
    const chunks = chunksRef.current;

    limpiarLatido();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    mediaRecorderRef.current = null;
    inicioGrabacionRef.current = null;
    baseSegundosRef.current = 0;
    chunksRef.current = [];
    modoDetencionRef.current = "descartar";

    if (chunks.length === 0) {
      irAError("No se pudo capturar audio de la sesión.");
      return;
    }

    cambiarEstado("cifrando");

    if (componenteMontadoRef.current) {
      setSegundos(duracionSegundos);
      setNivelAudio(0);
      setAudioSilencioso(false);
    }

    let audioSinCifrar: Blob | null = new Blob(chunks, {
      type: mimeType || "audio/webm",
    });

    if (audioSinCifrar.size === 0) {
      audioSinCifrar = null;
      irAError("No se pudo capturar audio de la sesión.");
      return;
    }

    try {
      const claveCifrado = await generarClave();
      const bufferAudio = await audioSinCifrar.arrayBuffer();
      const { iv, datosCifrados } = await cifrar(bufferAudio, claveCifrado);

      audioSinCifrar = null;

      const audioBlob = new Blob([base64ABytes(datosCifrados)], {
        type: "application/octet-stream",
      });

      if (componenteMontadoRef.current) {
        setMensajeError(null);
      }

      cambiarEstado("entregada");
      // Los chunks persistidos se limpian recién tras la confirmación de la
      // subida (lo hace la pantalla): si falla, siguen siendo recuperables.
      onListoRef.current({
        audioBlob,
        claveCifrado,
        ivCifrado: iv,
        duracionSegundos,
        pausas: pausasFinales,
      });
    } catch {
      irAError("No se pudo cifrar el audio. Probá de nuevo.");
    }
  }

  // El micrófono murió o quedó muteado demasiado tiempo (llamada entrante,
  // otra app se lo llevó). Se detiene el recorder sin descartar nada: los
  // chunks en RAM y en IndexedDB se preservan para reanudar o completar.
  function manejarInterrupcion() {
    if (estadoRef.current !== "grabando" && estadoRef.current !== "pausado") {
      return;
    }

    // Una interrupción cuenta como pausa (el cronómetro se detiene igual);
    // si ya había una pausa manual abierta, esa sigue siendo la abierta.
    if (estadoRef.current === "grabando") {
      abrirPausa();
    }

    limpiarLatido();
    limpiarMuteTimeout();
    modoDetencionRef.current = "pausar";

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // El recorder ya estaba muerto; seguimos igual.
      }
    }

    mediaRecorderRef.current = null;
    liberarStream();
    liberarWakeLock();

    if (componenteMontadoRef.current) {
      setSegundos(calcularSegundos());
      setNivelAudio(0);
      setAudioSilencioso(false);
      setMensajeError(null);
    }

    cambiarEstado("interrumpida");
  }

  React.useEffect(() => {
    manejarInterrupcionRef.current = manejarInterrupcion;
  });

  function vigilarPistaDeAudio(stream: MediaStream) {
    const pista = stream.getAudioTracks()[0];

    if (!pista) {
      return;
    }

    pista.onended = () => {
      manejarInterrupcionRef.current();
    };

    pista.onmute = () => {
      limpiarMuteTimeout();
      muteTimeoutRef.current = window.setTimeout(() => {
        muteTimeoutRef.current = null;
        manejarInterrupcionRef.current();
      }, MUTE_INTERRUPCION_MS);
    };

    pista.onunmute = () => {
      limpiarMuteTimeout();
    };
  }

  // Medidor de nivel. Es solo feedback visual: si el navegador no expone
  // AudioContext, la grabación sigue y el medidor queda en cero.
  function conectarAnalisis(stream: MediaStream) {
    const Constructor =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext);

    if (!Constructor) {
      return;
    }

    try {
      const contexto = new Constructor();
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      contexto.createMediaStreamSource(stream).connect(analizador);

      audioContextRef.current = contexto;
      analizadorRef.current = analizador;
      muestraRef.current = new Uint8Array(new ArrayBuffer(analizador.fftSize));
      silencioDesdeRef.current = null;
    } catch (error) {
      console.warn("[useGrabador] No se pudo medir el nivel de audio", error);
      liberarAnalisis();
    }
  }

  function medirNivel() {
    const analizador = analizadorRef.current;
    const muestra = muestraRef.current;

    if (!analizador || !muestra) {
      return;
    }

    analizador.getByteTimeDomainData(muestra);

    let suma = 0;
    for (let i = 0; i < muestra.length; i += 1) {
      const desvio = (muestra[i] - 128) / 128;
      suma += desvio * desvio;
    }

    const rms = Math.sqrt(suma / muestra.length);
    setNivelAudio(Math.min(1, rms * 6));

    const ahora = Date.now();

    if (rms < UMBRAL_SILENCIO) {
      const desde = silencioDesdeRef.current ?? ahora;
      silencioDesdeRef.current = desde;
      setAudioSilencioso(ahora - desde >= SILENCIO_AVISO_MS);
      return;
    }

    silencioDesdeRef.current = null;
    setAudioSilencioso(false);
  }

  // Cablea recorder + stream + persistencia. Usado tanto al iniciar como al
  // reanudar tras una interrupción (los chunks nuevos se anexan a los previos:
  // el archivo final sigue siendo uno solo).
  function conectarRecorder(stream: MediaStream) {
    const recorder = crearMediaRecorder(stream);

    streamRef.current = stream;
    mediaRecorderRef.current = recorder;
    mimeTypeRef.current = recorder.mimeType || mimeTypeRef.current;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
        const clave = claveRef.current;

        if (clave) {
          // Fire-and-forget: el backup en disco nunca bloquea la grabación.
          void guardarChunk(clave, chunkIndiceRef.current, event.data);
        }

        chunkIndiceRef.current += 1;
      }
    };

    recorder.onerror = () => {
      // Un problema del navegador se trata como interrupción: los chunks ya
      // capturados nunca se descartan por esto.
      manejarInterrupcionRef.current();
    };

    recorder.onstop = () => {
      const mimeType = mimeTypeRef.current || "audio/webm";

      if (modoDetencionRef.current === "completar") {
        void procesarGrabacion(mimeType);
        return;
      }

      if (modoDetencionRef.current === "pausar") {
        // Interrupción: manejarInterrupcion ya dejó el estado listo para
        // reanudar. No se descarta nada.
        return;
      }

      // Descartar: se limpia la RAM. Los chunks persistidos en IndexedDB se
      // conservan a propósito — son el seguro contra pagehide/cierre.
      volverAInactivo();
    };

    vigilarPistaDeAudio(stream);
    conectarAnalisis(stream);
    recorder.start(1000);
  }

  function iniciarLatido() {
    limpiarLatido();

    intervaloRef.current = window.setInterval(() => {
      if (estadoRef.current !== "grabando") {
        return;
      }

      medirNivel();

      const transcurridos = calcularSegundos();

      if (transcurridos >= LIMITE_SEGUNDOS) {
        limpiarLatido();
        setSegundos(LIMITE_SEGUNDOS);

        if (componenteMontadoRef.current) {
          setLimiteAlcanzado(true);
        }

        cambiarEstado("cifrando");
        detenerGrabacionActiva("completar");
        return;
      }

      setSegundos(transcurridos);
    }, LATIDO_MS);
  }

  function detenerGrabacionActiva(modo: ModoDetencion) {
    const recorder = mediaRecorderRef.current;

    modoDetencionRef.current = modo;
    limpiarLatido();

    if (!recorder || recorder.state === "inactive") {
      if (modo === "descartar") {
        volverAInactivo();
      }
      return;
    }

    try {
      recorder.stop();
    } catch {
      irAError("No se pudo detener la grabación.");
      return;
    }

    if (modo === "descartar") {
      liberarStream();
      liberarWakeLock();
    }
  }

  React.useEffect(() => {
    detenerActivaRef.current = detenerGrabacionActiva;
  });

  React.useEffect(() => {
    const onPageHide = () => {
      // Descarta lo que vive en RAM (el proceso puede morir), pero los chunks
      // ya persistidos en IndexedDB quedan: son la recuperación post-cierre.
      detenerActivaRef.current("descartar");
    };

    window.addEventListener("pagehide", onPageHide);

    return () => {
      componenteMontadoRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      detenerActivaRef.current("descartar");
      limpiarLatido();
      limpiarMuteTimeout();
      liberarStream();
      liberarWakeLock();
      limpiarMemoria();
    };
    // Las cinco son useCallback con dependencias estables: el efecto se monta
    // y se desmonta una sola vez. Si alguna dejara de serlo, este cleanup
    // correría a mitad de una grabación y marcaría el componente como
    // desmontado — de ahí que estén declaradas y no silenciadas.
  }, [
    liberarStream,
    liberarWakeLock,
    limpiarLatido,
    limpiarMemoria,
    limpiarMuteTimeout,
  ]);

  // Wake lock: el SO lo libera solo al bloquear la pantalla o cambiar de app.
  // Al volver a ser visible con una grabación en curso, lo re-adquirimos.
  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        (estadoRef.current === "grabando" || estadoRef.current === "pausado")
      ) {
        void adquirirWakeLock();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [adquirirWakeLock]);

  // Recuperación al montar: si quedó una grabación persistida de este mismo
  // turno (el navegador mató el proceso a mitad de grabación), se ofrece
  // enviarla o descartarla.
  React.useEffect(() => {
    if (!claveGrabacion) {
      return;
    }

    let cancelado = false;

    void recuperarGrabacionPendiente().then((recuperada) => {
      if (cancelado || !recuperada) {
        return;
      }

      if (recuperada.sesionClinicaId !== claveGrabacion) {
        return;
      }

      if (estadoRef.current !== "inactivo") {
        return;
      }

      setPendiente({
        chunks: recuperada.chunks,
        duracionAproxSeg: recuperada.duracionAproxSeg,
        pausas: recuperada.pausas,
      });
    });

    return () => {
      cancelado = true;
    };
  }, [claveGrabacion]);

  async function iniciar(clave: string) {
    claveRef.current = clave;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      irAError("Tu navegador no soporta grabación de audio.");
      return;
    }

    limpiarLatido();
    limpiarMuteTimeout();
    liberarStream();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setMensajeError(null);
      setSegundos(0);
      setNivelAudio(0);
      setAudioSilencioso(false);
      setLimiteAlcanzado(false);
      setPausas([]);
      // Empezar una grabación nueva reemplaza la pendiente del mismo turno.
      setPendiente(null);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      chunksRef.current = [];
      chunkIndiceRef.current = 0;
      pausasRef.current = [];
      baseSegundosRef.current = 0;
      inicioGrabacionRef.current = Date.now();
      modoDetencionRef.current = "descartar";

      // Fire-and-forget: registra el inicio y limpia chunks viejos del turno.
      void iniciarSesionGrabacion(clave);

      conectarRecorder(stream);
      void adquirirWakeLock();

      cambiarEstado("grabando");
      iniciarLatido();
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
    }
  }

  // Pausa manual: MediaRecorder.pause() deja el recorder vivo, así que los
  // chunks que vengan después siguen siendo del mismo archivo. El cronómetro
  // se detiene porque la pausa abierta se descuenta en segundosGrabados.
  function pausar() {
    const recorder = mediaRecorderRef.current;

    if (
      estadoRef.current !== "grabando" ||
      !recorder ||
      recorder.state !== "recording" ||
      typeof recorder.pause !== "function"
    ) {
      return;
    }

    try {
      recorder.pause();
    } catch {
      return;
    }

    abrirPausa();
    limpiarLatido();

    if (componenteMontadoRef.current) {
      setSegundos(calcularSegundos());
      setNivelAudio(0);
      setAudioSilencioso(false);
    }

    cambiarEstado("pausado");
  }

  function reanudar() {
    const recorder = mediaRecorderRef.current;

    if (
      estadoRef.current !== "pausado" ||
      !recorder ||
      recorder.state !== "paused" ||
      typeof recorder.resume !== "function"
    ) {
      return;
    }

    try {
      recorder.resume();
    } catch {
      return;
    }

    cerrarPausa();
    cambiarEstado("grabando");
    iniciarLatido();
    void adquirirWakeLock();
  }

  function terminar() {
    const actual = estadoRef.current;

    if (actual === "interrumpida") {
      // No hay recorder vivo: se cifra directamente lo que quedó capturado.
      void procesarGrabacion(mimeTypeRef.current);
      return;
    }

    if (actual !== "grabando" && actual !== "pausado") {
      return;
    }

    cambiarEstado("cifrando");
    detenerGrabacionActiva("completar");
  }

  function descartar() {
    const clave = claveRef.current;

    if (clave) {
      void limpiarGrabacion(clave);
    }

    if (estadoRef.current === "grabando" || estadoRef.current === "pausado") {
      detenerGrabacionActiva("descartar");
      return;
    }

    volverAInactivo();
  }

  async function reanudarTrasInterrupcion() {
    if (estadoRef.current !== "interrumpida") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      modoDetencionRef.current = "descartar";

      // Se cierra la pausa justo antes de que el recorder vuelva a capturar:
      // el tramo sin micrófono no cuenta como tiempo grabado.
      cerrarPausa();
      conectarRecorder(stream);
      void adquirirWakeLock();

      if (componenteMontadoRef.current) {
        setMensajeError(null);
      }

      cambiarEstado("grabando");
      iniciarLatido();
    } catch (error) {
      // Seguimos en "interrumpida": lo grabado no se pierde y se puede
      // reintentar o terminar con lo que hay.
      if (componenteMontadoRef.current) {
        setMensajeError(mensajeErrorGrabacion(error));
      }
    }
  }

  function enviarPendiente() {
    const recuperada = pendiente;

    if (!recuperada || estadoRef.current !== "inactivo") {
      return;
    }

    setPendiente(null);

    chunksRef.current = [...recuperada.chunks];
    chunkIndiceRef.current = recuperada.chunks.length;
    pausasRef.current = recuperada.pausas;
    baseSegundosRef.current = recuperada.duracionAproxSeg;
    inicioGrabacionRef.current = null;

    void procesarGrabacion("audio/webm");
  }

  function descartarPendiente() {
    const clave = claveRef.current;

    setPendiente(null);

    if (clave) {
      void limpiarGrabacion(clave);
    }
  }

  return {
    estado,
    segundos,
    nivelAudio,
    audioSilencioso,
    wakeLockActivo,
    mensajeError,
    limiteAlcanzado,
    pendiente,
    pausas,
    iniciar,
    pausar,
    reanudar,
    terminar,
    descartar,
    reanudarTrasInterrupcion,
    enviarPendiente,
    descartarPendiente,
    resetear: volverAInactivo,
  };
}

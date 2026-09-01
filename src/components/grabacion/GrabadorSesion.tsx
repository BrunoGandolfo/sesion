"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";

import { cifrar, generarClave } from "@/lib/crypto";
import {
  guardarChunk,
  iniciarSesionGrabacion,
  limpiarGrabacion,
  recuperarGrabacionPendiente,
} from "@/lib/grabacion-storage";
import { Button, Card, Chip, EditorialRule } from "@/components/ui";

interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
}

interface GrabadorSesionProps {
  turnoId: string;
  pacienteNombre: string;
  onGrabacionCompleta: (datos: DatosGrabacion) => void;
  onError: (mensaje: string) => void;
}

type EstadoGrabador =
  | "idle"
  | "grabando"
  | "interrumpida"
  | "procesando"
  | "listo"
  | "error";

// "pausar": detención por interrupción del micrófono — los chunks en RAM y
// en IndexedDB se preservan para reanudar o completar más tarde.
type ModoDetencion = "completar" | "descartar" | "pausar";

type GrabacionCifrada = {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
};

type GrabacionPendienteUI = {
  chunks: Blob[];
  duracionAproxSeg: number;
};

const transicion = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1] as const,
};

// Safety net por tamaño máximo de upload (120 MB). WhisperX no tiene límite
// práctico de duración; el corte por timer es solo para evitar archivos enormes.
const LIMITE_SEGUNDOS = 5400;

// Si el track de audio queda muteado más de este tiempo (Android le quitó el
// micrófono a Chrome por una llamada, etc.), lo tratamos como interrupción.
const MUTE_INTERRUPCION_MS = 3000;

function formatearDuracion(totalSegundos: number) {
  const minutos = Math.floor(totalSegundos / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (totalSegundos % 60).toString().padStart(2, "0");
  return `${minutos}:${segundos}`;
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

function chipDeEstado(estado: EstadoGrabador) {
  switch (estado) {
    case "grabando":
      return { label: "Grabando", variant: "terracotta" as const };
    case "interrumpida":
      return { label: "Interrumpida", variant: "terracotta" as const };
    case "procesando":
      return { label: "Cifrando", variant: "gold" as const };
    case "listo":
      return { label: "Listo", variant: "sage" as const };
    case "error":
      return { label: "Error", variant: "terracotta" as const };
    default:
      return { label: "Preparado", variant: "neutral" as const };
  }
}

export function GrabadorSesion({
  turnoId,
  pacienteNombre,
  onGrabacionCompleta,
  onError,
}: GrabadorSesionProps) {
  const [estado, setEstado] = React.useState<EstadoGrabador>("idle");
  const [segundosActuales, setSegundosActuales] = React.useState(0);
  const [duracionFinal, setDuracionFinal] = React.useState<number | null>(null);
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = React.useState(false);
  const [pendiente, setPendiente] =
    React.useState<GrabacionPendienteUI | null>(null);
  // false cuando el navegador no soporta wake lock, el request rechazó o el SO
  // lo soltó (evento "release"). Solo se muestra un aviso mientras se graba.
  const [wakeLockActivo, setWakeLockActivo] = React.useState(true);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const chunkIndiceRef = React.useRef(0);
  const inicioGrabacionRef = React.useRef<number | null>(null);
  // Segundos acumulados de segmentos previos (antes de una interrupción).
  const segundosPreviosRef = React.useRef(0);
  const intervaloTimerRef = React.useRef<number | null>(null);
  const muteTimeoutRef = React.useRef<number | null>(null);
  const mimeTypeRef = React.useRef("audio/webm");
  const modoDetencionRef = React.useRef<ModoDetencion>("descartar");
  const grabacionListaRef = React.useRef<GrabacionCifrada | null>(null);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);
  const wakeLockReleaseHandlerRef = React.useRef<(() => void) | null>(null);
  const estadoRef = React.useRef<EstadoGrabador>("idle");
  const componenteMontadoRef = React.useRef(true);
  const onErrorRef = React.useRef(onError);
  const detenerActivaRef = React.useRef<(modo: ModoDetencion) => void>(() => {});
  const manejarInterrupcionRef = React.useRef<() => void>(() => {});

  // Clave con la que se persisten los chunks en IndexedDB. El componente no
  // recibe el id de la sesión clínica, pero turno ↔ sesión clínica es 1:1.
  const claveGrabacion = turnoId;

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  function cambiarEstado(nuevo: EstadoGrabador) {
    estadoRef.current = nuevo;

    if (componenteMontadoRef.current) {
      setEstado(nuevo);
    }
  }

  function limpiarTimer() {
    if (intervaloTimerRef.current !== null) {
      window.clearInterval(intervaloTimerRef.current);
      intervaloTimerRef.current = null;
    }
  }

  function limpiarMuteTimeout() {
    if (muteTimeoutRef.current !== null) {
      window.clearTimeout(muteTimeoutRef.current);
      muteTimeoutRef.current = null;
    }
  }

  function liberarStream() {
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
  }

  function marcarWakeLock(activo: boolean) {
    if (componenteMontadoRef.current) {
      setWakeLockActivo(activo);
    }
  }

  async function adquirirWakeLock() {
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
      if (!componenteMontadoRef.current || estadoRef.current !== "grabando") {
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
      console.warn("[GrabadorSesion] No se pudo adquirir el wake lock", error);
      marcarWakeLock(false);
    }
  }

  function liberarWakeLock() {
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
  }

  function calcularDuracionActual() {
    const inicio = inicioGrabacionRef.current;
    const segmentoActual =
      inicio === null ? 0 : Math.max(0, Math.floor((Date.now() - inicio) / 1000));

    return segundosPreviosRef.current + segmentoActual;
  }

  function limpiarMemoria() {
    chunksRef.current = [];
    chunkIndiceRef.current = 0;
    grabacionListaRef.current = null;
    inicioGrabacionRef.current = null;
    segundosPreviosRef.current = 0;
    modoDetencionRef.current = "descartar";
    mediaRecorderRef.current = null;
  }

  // OJO: irAError NO borra los chunks persistidos en IndexedDB — si el
  // cifrado falla, esa copia es la única que queda y se puede recuperar.
  function irAError(mensaje: string) {
    limpiarTimer();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setSegundosActuales(0);
      setDuracionFinal(null);
      setMensajeError(mensaje);
    }

    cambiarEstado("error");
    onErrorRef.current(mensaje);
  }

  function resetearAIdle() {
    limpiarTimer();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setSegundosActuales(0);
      setDuracionFinal(null);
      setMensajeError(null);
      setLimiteAlcanzado(false);
    }

    cambiarEstado("idle");
  }

  async function procesarGrabacion(mimeType: string) {
    const duracionSegundos = Math.max(1, calcularDuracionActual());
    const chunks = chunksRef.current;

    limpiarTimer();
    limpiarMuteTimeout();
    liberarStream();
    liberarWakeLock();
    mediaRecorderRef.current = null;
    inicioGrabacionRef.current = null;
    segundosPreviosRef.current = 0;
    chunksRef.current = [];
    modoDetencionRef.current = "descartar";

    if (chunks.length === 0) {
      irAError("No se pudo capturar audio de la sesión.");
      return;
    }

    cambiarEstado("procesando");

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

      grabacionListaRef.current = {
        audioBlob,
        claveCifrado,
        ivCifrado: iv,
        duracionSegundos,
      };

      if (componenteMontadoRef.current) {
        setMensajeError(null);
        setSegundosActuales(duracionSegundos);
        setDuracionFinal(duracionSegundos);
      }

      cambiarEstado("listo");
    } catch {
      irAError("No se pudo cifrar el audio. Probá de nuevo.");
    }
  }

  // El micrófono murió o quedó muteado demasiado tiempo (bloqueo de pantalla,
  // llamada entrante, etc.). Pausamos sin descartar nada: los chunks en RAM y
  // en IndexedDB se preservan para reanudar o completar.
  function manejarInterrupcion() {
    if (estadoRef.current !== "grabando") {
      return;
    }

    const inicio = inicioGrabacionRef.current;

    if (inicio !== null) {
      segundosPreviosRef.current += Math.max(
        0,
        Math.floor((Date.now() - inicio) / 1000),
      );
      inicioGrabacionRef.current = null;
    }

    limpiarTimer();
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
      setSegundosActuales(segundosPreviosRef.current);
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

  // Cablea recorder + stream + persistencia. Usado tanto al iniciar como al
  // reanudar tras una interrupción (los chunks nuevos se anexan a los previos).
  function conectarRecorder(stream: MediaStream) {
    const recorder = crearMediaRecorder(stream);

    streamRef.current = stream;
    mediaRecorderRef.current = recorder;
    mimeTypeRef.current = recorder.mimeType || mimeTypeRef.current;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
        // Fire-and-forget: el backup en disco nunca bloquea la grabación.
        void guardarChunk(claveGrabacion, chunkIndiceRef.current, event.data);
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
      limpiarTimer();
      limpiarMuteTimeout();
      liberarStream();
      liberarWakeLock();
      limpiarMemoria();

      if (componenteMontadoRef.current) {
        setSegundosActuales(0);
        setDuracionFinal(null);
      }

      cambiarEstado("idle");
    };

    vigilarPistaDeAudio(stream);
    recorder.start(1000);
  }

  function iniciarTimer() {
    limpiarTimer();

    intervaloTimerRef.current = window.setInterval(() => {
      if (inicioGrabacionRef.current === null) {
        return;
      }

      const transcurridos = calcularDuracionActual();

      if (transcurridos >= LIMITE_SEGUNDOS) {
        limpiarTimer();
        setSegundosActuales(LIMITE_SEGUNDOS);
        if (componenteMontadoRef.current) {
          setLimiteAlcanzado(true);
        }
        cambiarEstado("procesando");
        detenerGrabacionActiva("completar");
        return;
      }

      setSegundosActuales(transcurridos);
    }, 1000);
  }

  function detenerGrabacionActiva(modo: ModoDetencion) {
    const recorder = mediaRecorderRef.current;

    modoDetencionRef.current = modo;
    limpiarTimer();

    if (!recorder || recorder.state === "inactive") {
      if (modo === "descartar") {
        resetearAIdle();
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
      limpiarTimer();
      limpiarMuteTimeout();
      liberarStream();
      liberarWakeLock();
      limpiarMemoria();
    };
  }, []);

  // Wake lock: el SO lo libera solo al bloquear la pantalla o cambiar de app.
  // Al volver a ser visible con una grabación activa, lo re-adquirimos.
  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        estadoRef.current === "grabando"
      ) {
        void adquirirWakeLock();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Recuperación al montar: si quedó una grabación persistida de esta misma
  // sesión (el navegador mató el proceso a mitad de grabación), se ofrece
  // enviarla o descartarla. Este componente solo se monta cuando la sesión
  // clínica activa está en estado "grabando", así que la coincidencia de
  // clave alcanza para saber que es la grabación huérfana de esta sesión.
  React.useEffect(() => {
    let cancelado = false;

    void recuperarGrabacionPendiente().then((recuperada) => {
      if (cancelado || !recuperada) {
        return;
      }

      if (recuperada.sesionClinicaId !== claveGrabacion) {
        return;
      }

      if (estadoRef.current !== "idle") {
        return;
      }

      setPendiente({
        chunks: recuperada.chunks,
        duracionAproxSeg: recuperada.duracionAproxSeg,
      });
    });

    return () => {
      cancelado = true;
    };
  }, [claveGrabacion]);

  async function iniciarGrabacion() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      irAError("Tu navegador no soporta grabación de audio.");
      return;
    }

    limpiarTimer();
    limpiarMuteTimeout();
    liberarStream();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setMensajeError(null);
      setDuracionFinal(null);
      setSegundosActuales(0);
      setLimiteAlcanzado(false);
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
      segundosPreviosRef.current = 0;
      inicioGrabacionRef.current = Date.now();
      modoDetencionRef.current = "descartar";

      // Fire-and-forget: registra el inicio y limpia chunks viejos del turno.
      void iniciarSesionGrabacion(claveGrabacion);

      conectarRecorder(stream);
      void adquirirWakeLock();

      cambiarEstado("grabando");
      iniciarTimer();
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
    }
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
      inicioGrabacionRef.current = Date.now();

      conectarRecorder(stream);
      void adquirirWakeLock();

      if (componenteMontadoRef.current) {
        setMensajeError(null);
      }

      cambiarEstado("grabando");
      iniciarTimer();
    } catch (error) {
      // Seguimos en "interrumpida": lo grabado no se pierde y se puede
      // reintentar o completar con lo que hay.
      if (componenteMontadoRef.current) {
        setMensajeError(mensajeErrorGrabacion(error));
      }
    }
  }

  function completarDesdeInterrupcion() {
    if (estadoRef.current !== "interrumpida") {
      return;
    }

    void procesarGrabacion(mimeTypeRef.current);
  }

  function detenerGrabacion() {
    if (estado !== "grabando") {
      return;
    }

    cambiarEstado("procesando");
    detenerGrabacionActiva("completar");
  }

  function enviarGrabacion() {
    const grabacion = grabacionListaRef.current;

    if (!grabacion) {
      irAError("La grabación cifrada ya no está disponible.");
      return;
    }

    try {
      // Los chunks persistidos se limpian recién tras el upload exitoso
      // (lo hace useGrabacionSesion), no acá: si la subida falla, siguen
      // siendo recuperables.
      onGrabacionCompleta(grabacion);
      resetearAIdle();
    } catch (error) {
      const mensaje =
        error instanceof Error && error.message
          ? error.message
          : "No se pudo enviar la grabación.";
      irAError(mensaje);
    }
  }

  function descartarGrabacion() {
    void limpiarGrabacion(claveGrabacion);
    resetearAIdle();
  }

  function enviarPendiente() {
    const recuperada = pendiente;

    if (!recuperada || estadoRef.current !== "idle") {
      return;
    }

    setPendiente(null);

    chunksRef.current = [...recuperada.chunks];
    chunkIndiceRef.current = recuperada.chunks.length;
    segundosPreviosRef.current = recuperada.duracionAproxSeg;
    inicioGrabacionRef.current = null;

    void procesarGrabacion("audio/webm");
  }

  function descartarPendiente() {
    setPendiente(null);
    void limpiarGrabacion(claveGrabacion);
  }

  async function reintentar() {
    resetearAIdle();
    await iniciarGrabacion();
  }

  const chipEstado = chipDeEstado(estado);
  const tiempoVisible =
    estado === "listo"
      ? formatearDuracion(duracionFinal ?? 0)
      : formatearDuracion(segundosActuales);
  const minutosPendiente = pendiente
    ? Math.max(1, Math.round(pendiente.duracionAproxSeg / 60))
    : 0;

  return (
    <Card
      elevated
      data-turno-id={turnoId}
      className="overflow-hidden border-[color:var(--border-subtle)]"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <EditorialRule className="w-8 bg-sage-500" />
              <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Grabación segura
              </span>
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-[26px] leading-none text-ink-900">
                {pacienteNombre}
              </h2>
              <p className="text-[13px] text-ink-500">
                El audio se cifra en este dispositivo antes de quedar listo para enviar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Chip variant={chipEstado.variant}>{chipEstado.label}</Chip>
            <span className="rounded-full bg-cream-100 px-3 py-[6px] text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-ink-500">
              Turno {turnoId}
            </span>
          </div>
        </div>

        <div className="rounded-[14px] border border-[color:var(--border-subtle)] bg-[linear-gradient(135deg,rgba(243,246,244,0.95),rgba(250,250,246,0.98))] p-5 sm:p-6">
          <AnimatePresence mode="wait" initial={false}>
            {estado === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col gap-5"
              >
                {pendiente && (
                  <div className="flex flex-col gap-3 rounded-[12px] border border-[color:var(--color-error)]/20 bg-[rgba(160,64,64,0.06)] p-4">
                    <div className="flex items-start gap-3">
                      <CircleAlert
                        size={18}
                        strokeWidth={1.9}
                        aria-hidden="true"
                        className="mt-[2px] shrink-0 text-[color:var(--color-error)]"
                      />
                      <div className="space-y-1">
                        <p className="text-[15px] font-semibold text-ink-900">
                          Hay una grabación interrumpida de ~{minutosPendiente} min
                        </p>
                        <p className="text-[13px] leading-6 text-ink-700">
                          La sesión anterior se cortó antes de enviarse, pero el
                          audio quedó guardado en este dispositivo.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        onClick={enviarPendiente}
                        icon={<Send size={15} strokeWidth={1.8} aria-hidden="true" />}
                        className="w-full sm:flex-1"
                      >
                        Enviar
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={descartarPendiente}
                        icon={<Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />}
                        className="w-full sm:w-auto"
                      >
                        Descartar
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[15px] leading-6 text-ink-700">
                    Cuando arranques, el grabador va a capturar solo audio. El archivo
                    queda cifrado antes de salir del navegador.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-flex items-center gap-2 text-[13px] text-ink-500">
                    <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
                    <span>AES-256 en el navegador</span>
                  </div>

                  <Button
                    onClick={() => {
                      void iniciarGrabacion();
                    }}
                    icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}
                    className="w-full sm:w-auto"
                  >
                    Iniciar grabación
                  </Button>
                </div>
              </motion.div>
            )}

            {estado === "grabando" && (
              <motion.div
                key="grabando"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col items-center gap-5 text-center"
              >
                <motion.div
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(160,64,64,0.12)]"
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY }}
                >
                  <motion.span
                    className="block h-4 w-4 rounded-full bg-[color:var(--color-error)]"
                    animate={{ opacity: [1, 0.45, 1] }}
                    transition={{ duration: 1.2, repeat: Number.POSITIVE_INFINITY }}
                  />
                </motion.div>

                <div className="space-y-2">
                  <p className="font-mono text-[24px] font-semibold tabular-nums text-ink-900">
                    {tiempoVisible}
                  </p>
                  <p className="text-[14px] text-ink-500">
                    Grabando la sesión de {pacienteNombre}
                  </p>
                  {!wakeLockActivo && (
                    <p className="text-[13px] text-ink-500">
                      Mantené la pantalla encendida mientras grabás.
                    </p>
                  )}
                </div>

                <Button
                  onClick={detenerGrabacion}
                  icon={<Square size={15} strokeWidth={2} aria-hidden="true" />}
                  className="w-full border-transparent bg-[color:var(--color-error)] text-white hover:bg-[#8f3b3b] active:bg-[#7c3232] sm:w-auto"
                >
                  Detener
                </Button>
              </motion.div>
            )}

            {estado === "interrumpida" && (
              <motion.div
                key="interrumpida"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col gap-5"
              >
                <div className="flex items-start gap-3 rounded-[12px] border border-[color:var(--color-error)]/20 bg-[rgba(160,64,64,0.06)] p-4">
                  <MicOff
                    size={18}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="mt-[2px] shrink-0 text-[color:var(--color-error)]"
                  />
                  <div className="space-y-1">
                    <p className="text-[15px] font-semibold text-ink-900">
                      El micrófono se interrumpió — tocá Reanudar
                    </p>
                    <p className="text-[13px] leading-6 text-ink-700">
                      Puede pasar por una llamada entrante o el bloqueo de
                      pantalla. Lo grabado hasta ahora (
                      <span className="font-mono tabular-nums">{tiempoVisible}</span>
                      ) está a salvo.
                    </p>
                    {mensajeError && (
                      <p className="pt-1 text-[13px] leading-6 text-[color:var(--color-error)]">
                        {mensajeError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    onClick={() => {
                      void reanudarTrasInterrupcion();
                    }}
                    icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}
                    className="w-full sm:flex-1"
                  >
                    Reanudar
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={completarDesdeInterrupcion}
                    icon={<Square size={15} strokeWidth={2} aria-hidden="true" />}
                    className="w-full sm:w-auto"
                  >
                    Detener y usar lo grabado
                  </Button>
                </div>
              </motion.div>
            )}

            {estado === "procesando" && (
              <motion.div
                key="procesando"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col items-center gap-4 py-4 text-center"
              >
                <LoaderCircle
                  size={28}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="animate-spin text-sage-500"
                />
                <div className="space-y-1">
                  <p className="font-sans text-[16px] font-semibold text-ink-900">
                    Cifrando audio...
                  </p>
                  <p className="text-[13px] text-ink-500">
                    Esto puede llevar unos segundos según la duración.
                  </p>
                </div>
              </motion.div>
            )}

            {estado === "listo" && (
              <motion.div
                key="listo"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col gap-5"
              >
                <div className="flex items-start gap-3 rounded-[12px] border border-sage-200 bg-white/80 p-4">
                  <ShieldCheck
                    size={18}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="mt-[2px] shrink-0 text-sage-500"
                  />
                  <div className="space-y-1">
                    <p className="text-[15px] font-semibold text-ink-900">
                      Audio cifrado listo
                    </p>
                    <p className="text-[13px] text-ink-500">
                      Duración total:{" "}
                      <span className="font-mono tabular-nums text-ink-900">
                        {formatearDuracion(duracionFinal ?? 0)}
                      </span>
                    </p>
                    {limiteAlcanzado && (
                      <p className="pt-1 text-[12px] text-ink-500">
                        Se alcanzó el límite de grabación de 90 minutos.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    onClick={enviarGrabacion}
                    icon={<Send size={16} strokeWidth={1.8} aria-hidden="true" />}
                    className="w-full sm:flex-1"
                  >
                    Enviar
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={descartarGrabacion}
                    icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
                    className="w-full sm:w-auto"
                  >
                    Descartar
                  </Button>
                </div>
              </motion.div>
            )}

            {estado === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transicion}
                className="flex flex-col gap-5"
              >
                <div className="flex items-start gap-3 rounded-[12px] border border-[color:var(--color-error)]/20 bg-[rgba(160,64,64,0.06)] p-4">
                  <CircleAlert
                    size={18}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="mt-[2px] shrink-0 text-[color:var(--color-error)]"
                  />
                  <div className="space-y-1">
                    <p className="text-[15px] font-semibold text-ink-900">
                      No pudimos completar la grabación
                    </p>
                    <p className="text-[13px] leading-6 text-ink-700">
                      {mensajeError ?? "Ocurrió un problema inesperado."}
                    </p>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => {
                    void reintentar();
                  }}
                  icon={<RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />}
                  className="w-full sm:w-auto"
                >
                  Reintentar
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}

"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  Clock,
  LoaderCircle,
  Mic,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";

import { cifrar, generarClave } from "@/lib/crypto";
import { Button, Card, Chip, EditorialRule } from "@/components/ui";

interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
  esParte?: number; // undefined = grabación única; 1, 2, 3… = parte de un split por límite de 60 min
}

interface DatosGrabacionParte1 {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
  esParte: number;
}

interface GrabadorSesionProps {
  turnoId: string;
  pacienteNombre: string;
  onGrabacionCompleta: (datos: DatosGrabacion) => void;
  onError: (mensaje: string) => void;
  onParte2?: (datosParte1: DatosGrabacionParte1) => void;
}

type EstadoGrabador = "idle" | "grabando" | "procesando" | "listo" | "error";
type ModoDetencion = "completar" | "descartar";

type GrabacionCifrada = {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
};

const transicion = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1] as const,
};

// Límite duro del modelo ASR (VibeVoice-ASR): 60 min por inferencia.
const LIMITE_SEGUNDOS = 3600;

type NivelWarning = 50 | 55 | 58;

const UMBRALES_WARNING: { nivel: NivelWarning; desde: number }[] = [
  { nivel: 58, desde: 3480 },
  { nivel: 55, desde: 3300 },
  { nivel: 50, desde: 3000 },
];

interface ConfigBanner {
  texto: string;
  containerClass: string;
  iconClass: string;
}

const CONFIG_BANNER: Record<NivelWarning, ConfigBanner> = {
  50: {
    texto: "10 minutos restantes",
    containerClass:
      "bg-sage-50 text-sage-700 border-sage-200",
    iconClass: "text-sage-500",
  },
  55: {
    texto: "5 minutos, considerá cerrar",
    containerClass:
      "bg-gold-50 text-gold-500 border-[color:var(--color-gold-100,#F2E2BE)]",
    iconClass: "text-gold-500",
  },
  58: {
    texto: "2 min antes del corte automático",
    containerClass:
      "bg-terracotta-50 text-terracotta-500 border-terracotta-100",
    iconClass: "text-terracotta-500",
  },
};

function calcularNivelWarning(segundos: number): NivelWarning | null {
  for (const { nivel, desde } of UMBRALES_WARNING) {
    if (segundos >= desde) return nivel;
  }
  return null;
}

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
  onParte2,
}: GrabadorSesionProps) {
  const [estado, setEstado] = React.useState<EstadoGrabador>("idle");
  const [segundosActuales, setSegundosActuales] = React.useState(0);
  const [duracionFinal, setDuracionFinal] = React.useState<number | null>(null);
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = React.useState<NivelWarning | null>(null);
  const [mostrarModalCorte, setMostrarModalCorte] = React.useState(false);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const inicioGrabacionRef = React.useRef<number | null>(null);
  const intervaloTimerRef = React.useRef<number | null>(null);
  const modoDetencionRef = React.useRef<ModoDetencion>("descartar");
  const grabacionListaRef = React.useRef<GrabacionCifrada | null>(null);
  const componenteMontadoRef = React.useRef(true);
  const onErrorRef = React.useRef(onError);
  const onParte2Ref = React.useRef(onParte2);
  const detenerActivaRef = React.useRef<(modo: ModoDetencion) => void>(() => {});
  const parteActualRef = React.useRef(1);
  const intencionParte2Ref = React.useRef(false);
  const recorderPausadoRef = React.useRef(false);
  const cortePendienteRef = React.useRef(false);

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  React.useEffect(() => {
    onParte2Ref.current = onParte2;
  }, [onParte2]);

  function limpiarTimer() {
    if (intervaloTimerRef.current !== null) {
      window.clearInterval(intervaloTimerRef.current);
      intervaloTimerRef.current = null;
    }
  }

  function liberarStream() {
    if (!streamRef.current) {
      return;
    }

    for (const track of streamRef.current.getTracks()) {
      track.stop();
    }

    streamRef.current = null;
  }

  function limpiarMemoria() {
    chunksRef.current = [];
    grabacionListaRef.current = null;
    inicioGrabacionRef.current = null;
    modoDetencionRef.current = "descartar";
    mediaRecorderRef.current = null;
  }

  function irAError(mensaje: string) {
    limpiarTimer();
    liberarStream();
    limpiarMemoria();

    if (componenteMontadoRef.current) {
      setSegundosActuales(0);
      setDuracionFinal(null);
      setMensajeError(mensaje);
      setEstado("error");
    }

    onErrorRef.current(mensaje);
  }

  function resetearAIdle() {
    limpiarTimer();
    liberarStream();
    limpiarMemoria();

    parteActualRef.current = 1;
    intencionParte2Ref.current = false;
    recorderPausadoRef.current = false;
    cortePendienteRef.current = false;

    if (componenteMontadoRef.current) {
      setSegundosActuales(0);
      setDuracionFinal(null);
      setMensajeError(null);
      setBannerDismissed(null);
      setMostrarModalCorte(false);
      setEstado("idle");
    }
  }

  async function procesarGrabacion(mimeType: string) {
    const inicio = inicioGrabacionRef.current;
    const duracionSegundos =
      inicio === null
        ? 0
        : Math.max(1, Math.round((Date.now() - inicio) / 1000));
    const chunks = chunksRef.current;

    limpiarTimer();
    liberarStream();
    mediaRecorderRef.current = null;
    inicioGrabacionRef.current = null;
    chunksRef.current = [];
    modoDetencionRef.current = "descartar";

    if (chunks.length === 0) {
      irAError("No se pudo capturar audio de la sesión.");
      return;
    }

    if (componenteMontadoRef.current) {
      setEstado("procesando");
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

      grabacionListaRef.current = {
        audioBlob,
        claveCifrado,
        ivCifrado: iv,
        duracionSegundos,
      };

      if (intencionParte2Ref.current) {
        await emitirYRestartParte2();
        return;
      }

      if (componenteMontadoRef.current) {
        setMensajeError(null);
        setSegundosActuales(duracionSegundos);
        setDuracionFinal(duracionSegundos);
        setEstado("listo");
      }
    } catch {
      irAError("No se pudo cifrar el audio. Probá de nuevo.");
    }
  }

  async function emitirYRestartParte2() {
    const datos = grabacionListaRef.current;
    intencionParte2Ref.current = false;

    if (!datos) {
      irAError("La grabación cifrada ya no está disponible.");
      return;
    }

    const parteCompletada = parteActualRef.current;
    const datosParte: DatosGrabacionParte1 = {
      audioBlob: datos.audioBlob,
      claveCifrado: datos.claveCifrado,
      ivCifrado: datos.ivCifrado,
      duracionSegundos: datos.duracionSegundos,
      esParte: parteCompletada,
    };

    try {
      onGrabacionCompleta(datosParte);
    } catch (error) {
      const mensaje =
        error instanceof Error && error.message
          ? error.message
          : "No se pudo enviar la grabación.";
      irAError(mensaje);
      return;
    }

    try {
      onParte2Ref.current?.(datosParte);
    } catch {
      // El padre se ocupa de loguear su propio error; no rompemos el flujo de grabación.
    }

    grabacionListaRef.current = null;
    parteActualRef.current = parteCompletada + 1;

    if (componenteMontadoRef.current) {
      setBannerDismissed(null);
      setMensajeError(null);
      setSegundosActuales(0);
      setDuracionFinal(null);
    }

    await iniciarGrabacion();
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
    }
  }

  React.useEffect(() => {
    detenerActivaRef.current = detenerGrabacionActiva;
  });

  React.useEffect(() => {
    const onPageHide = () => {
      detenerActivaRef.current("descartar");
    };

    window.addEventListener("pagehide", onPageHide);

    return () => {
      componenteMontadoRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      detenerActivaRef.current("descartar");
      limpiarTimer();
      liberarStream();
      limpiarMemoria();
    };
  }, []);

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
    liberarStream();
    limpiarMemoria();

    cortePendienteRef.current = false;
    recorderPausadoRef.current = false;

    if (componenteMontadoRef.current) {
      setMensajeError(null);
      setDuracionFinal(null);
      setSegundosActuales(0);
      setBannerDismissed(null);
      setMostrarModalCorte(false);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      const recorder = crearMediaRecorder(stream);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      inicioGrabacionRef.current = Date.now();
      modoDetencionRef.current = "descartar";

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        irAError("La grabación se interrumpió por un problema del navegador.");
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";

        if (modoDetencionRef.current === "completar") {
          void procesarGrabacion(mimeType);
          return;
        }

        limpiarTimer();
        liberarStream();
        limpiarMemoria();

        if (componenteMontadoRef.current) {
          setSegundosActuales(0);
          setDuracionFinal(null);
          setEstado("idle");
        }
      };

      recorder.start(1000);

      if (componenteMontadoRef.current) {
        setEstado("grabando");
      }

      intervaloTimerRef.current = window.setInterval(() => {
        const inicio = inicioGrabacionRef.current;

        if (inicio === null) {
          return;
        }

        const transcurridos = Math.max(
          0,
          Math.floor((Date.now() - inicio) / 1000),
        );

        if (transcurridos >= LIMITE_SEGUNDOS && !cortePendienteRef.current) {
          cortePendienteRef.current = true;
          setSegundosActuales(LIMITE_SEGUNDOS);
          handleCorte60();
          return;
        }

        if (cortePendienteRef.current) {
          return;
        }

        setSegundosActuales(transcurridos);
      }, 1000);
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
    }
  }

  function handleCorte60() {
    limpiarTimer();

    const recorder = mediaRecorderRef.current;
    let pausado = false;

    if (recorder && recorder.state === "recording" && typeof recorder.pause === "function") {
      try {
        recorder.pause();
        pausado = true;
      } catch {
        pausado = false;
      }
    }

    recorderPausadoRef.current = pausado;

    if (componenteMontadoRef.current) {
      setMostrarModalCorte(true);
    }

    // Fallback: si pause() no funcionó, cortamos suavemente. La encriptación
    // arranca en paralelo y la decisión del modal se aplica al resultado.
    if (!pausado) {
      const r = mediaRecorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          modoDetencionRef.current = "completar";
          r.stop();
        } catch {
          // ignorado: si stop falla, irAError se disparará via onerror del recorder
        }
      }
    }
  }

  function reanudarSiPausado() {
    if (!recorderPausadoRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    try {
      if (recorder.state === "paused" && typeof recorder.resume === "function") {
        recorder.resume();
      }
    } catch {
      // ignorado: si no se puede reanudar, stop() sigue funcionando desde estado paused
    }
    recorderPausadoRef.current = false;
  }

  function handleTerminarCorte() {
    intencionParte2Ref.current = false;

    if (componenteMontadoRef.current) {
      setMostrarModalCorte(false);
    }

    if (recorderPausadoRef.current) {
      reanudarSiPausado();
      if (componenteMontadoRef.current) {
        setEstado("procesando");
      }
      detenerGrabacionActiva("completar");
    }
    // Si ya estaba detenido (camino fallback), procesarGrabacion ya está en curso
    // y va a transicionar a "listo" porque intencionParte2Ref es false.
  }

  async function handleContinuarParte2() {
    intencionParte2Ref.current = true;

    if (componenteMontadoRef.current) {
      setMostrarModalCorte(false);
    }

    if (recorderPausadoRef.current) {
      reanudarSiPausado();
      if (componenteMontadoRef.current) {
        setEstado("procesando");
      }
      detenerGrabacionActiva("completar");
      return;
    }

    // Fallback: ya se llamó stop(). Si la encriptación terminó, emitimos ya;
    // si todavía está en curso, procesarGrabacion va a detectar la intención.
    if (grabacionListaRef.current) {
      await emitirYRestartParte2();
    }
  }

  function detenerGrabacion() {
    if (estado !== "grabando") {
      return;
    }

    if (componenteMontadoRef.current) {
      setEstado("procesando");
    }

    detenerGrabacionActiva("completar");
  }

  function enviarGrabacion() {
    const grabacion = grabacionListaRef.current;

    if (!grabacion) {
      irAError("La grabación cifrada ya no está disponible.");
      return;
    }

    try {
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
    resetearAIdle();
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

  const nivelWarning =
    estado === "grabando" ? calcularNivelWarning(segundosActuales) : null;
  const mostrarBanner =
    nivelWarning !== null &&
    (bannerDismissed === null || nivelWarning > bannerDismissed);
  const bannerConfig = nivelWarning !== null ? CONFIG_BANNER[nivelWarning] : null;
  const ofrecerParte2 = typeof onParte2 === "function";

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
                <AnimatePresence initial={false}>
                  {mostrarBanner && bannerConfig && nivelWarning !== null && (
                    <motion.div
                      key={`banner-${nivelWarning}`}
                      role="status"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={transicion}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 ${bannerConfig.containerClass}`}
                    >
                      <div className="flex items-center gap-2 text-left">
                        <Clock
                          size={16}
                          strokeWidth={1.8}
                          aria-hidden="true"
                          className={bannerConfig.iconClass}
                        />
                        <span className="font-sans text-[13px] font-semibold">
                          {bannerConfig.texto}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBannerDismissed(nivelWarning)}
                        aria-label="Descartar aviso"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5"
                      >
                        <X size={14} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

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

      <AnimatePresence>
        {mostrarModalCorte && (
          <>
            <motion.div
              key="corte-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              aria-hidden="true"
              className="fixed inset-0 z-40 bg-[rgba(26,38,40,0.4)] backdrop-blur-[2px]"
            />
            <motion.div
              key="corte-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Llegaste al límite de 60 minutos"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={transicion}
              className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-raised"
            >
              <div className="space-y-2">
                <h3 className="font-display text-[20px] leading-tight text-ink-900">
                  Llegaste al límite de 60 minutos
                </h3>
                <p className="text-[14px] leading-6 text-ink-700">
                  La grabación se pausó automáticamente. ¿Querés terminar acá o
                  seguir en una segunda parte?
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                {ofrecerParte2 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void handleContinuarParte2();
                    }}
                    className="w-full sm:w-auto"
                  >
                    Continuar en Parte 2
                  </Button>
                )}
                <Button
                  onClick={handleTerminarCorte}
                  className="w-full sm:w-auto"
                >
                  Terminar grabación
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Card>
  );
}

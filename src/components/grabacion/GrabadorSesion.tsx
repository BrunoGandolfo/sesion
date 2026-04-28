"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  LoaderCircle,
  Mic,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";

import { cifrar, generarClave } from "@/lib/crypto";
import { Button, Card, Chip, EditorialRule } from "@/components/ui";

interface GrabadorSesionProps {
  turnoId: string;
  pacienteNombre: string;
  onGrabacionCompleta: (datos: {
    audioBlob: Blob;
    claveCifrado: string;
    ivCifrado: string;
    duracionSegundos: number;
  }) => void;
  onError: (mensaje: string) => void;
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
}: GrabadorSesionProps) {
  const [estado, setEstado] = React.useState<EstadoGrabador>("idle");
  const [segundosActuales, setSegundosActuales] = React.useState(0);
  const [duracionFinal, setDuracionFinal] = React.useState<number | null>(null);
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const inicioGrabacionRef = React.useRef<number | null>(null);
  const intervaloTimerRef = React.useRef<number | null>(null);
  const modoDetencionRef = React.useRef<ModoDetencion>("descartar");
  const grabacionListaRef = React.useRef<GrabacionCifrada | null>(null);
  const componenteMontadoRef = React.useRef(true);
  const onErrorRef = React.useRef(onError);
  const detenerActivaRef = React.useRef<(modo: ModoDetencion) => void>(() => {});

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

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

    if (componenteMontadoRef.current) {
      setSegundosActuales(0);
      setDuracionFinal(null);
      setMensajeError(null);
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

    if (componenteMontadoRef.current) {
      setMensajeError(null);
      setDuracionFinal(null);
      setSegundosActuales(0);
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

        setSegundosActuales(Math.max(0, Math.floor((Date.now() - inicio) / 1000)));
      }, 1000);
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
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
    </Card>
  );
}

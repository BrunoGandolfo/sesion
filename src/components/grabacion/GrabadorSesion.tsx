"use client";

// El grabador de una sesión. SIN UI: la pantalla vive en /grabar/[turnoId].
//
// UNA GRABACIÓN ES UN MediaRecorder
//
// Desde Grabar hasta Terminar hay un solo MediaRecorder y un solo micrófono
// abierto. Nunca se pega la salida de dos recorders: cada uno escribe su
// propia cabecera de archivo, y dos archivos pegados no son un archivo. Por
// eso nada detiene el recorder salvo Terminar, Descartar, o que el micrófono
// se haya ido de verdad:
//
//   - la pausa manual y el tope de duración usan pause(): el recorder sigue
//     vivo y Reanudar continúa el mismo archivo;
//   - un micrófono silenciado (una llamada entrante) o un rato sin chunks (el
//     teléfono se bloqueó) NO cambian nada: la grabación sigue, y la pantalla
//     dice qué pasó, con horas, para que ella decida;
//   - si la pista terminó o el recorder falló, la grabación termina ahí. No se
//     puede seguir sin abrir otro recorder, así que sólo se ofrece guardar lo
//     grabado.
//
// Cuánto se grabó lo dicen los chunks recibidos (grabacion-captura.ts), no el
// reloj. El medidor de sonido es sólo un medidor: nunca corta nada.
//
// El audio no se cifra en la app. Los chunks van a IndexedDB como Blob y el
// archivo final es un Blob de Blobs: nunca se copia entero a memoria.

import * as React from "react";

import { aRegistradas, formatearDuracion } from "@/lib/grabacion-cronometro";
import { crearMediaRecorder, mensajeErrorGrabacion } from "@/lib/grabacion-microfono";
import {
  contarChunk,
  crearReloj,
  estadoLimite,
  HUECO_MS,
  LIMITE_SEGUNDOS,
  medidaInicial,
  MINIMO_SEGUNDOS,
  reanudarMedida,
  sinChunksDesde,
  TIMESLICE_MS,
  type Medida,
} from "@/lib/grabacion-captura";
import {
  guardarChunk,
  guardarPausas,
  iniciarSesionGrabacion,
  limpiarGrabacion,
  type Pausa,
} from "@/lib/grabacion-storage";
import { MAX_EVENTOS_GRABACION, type EventoGrabacion } from "@/lib/sesion-clinica/schema";

import { useGrabacionPendiente } from "./grabacion-pendiente";
import { useMicrofono } from "./grabador-microfono";
import type { AvisoHueco, EstadoGrabador, Grabador, UseGrabadorOpciones } from "./grabador-tipos";
import { useGuardaDeToque } from "./guarda-de-toque";

export { formatearDuracion };
export type { AvisoHueco, DatosGrabacion, EstadoGrabador, Grabador, PendienteGuardada } from "./grabador-tipos";

const GRABACION_VACIA = "No se pudo capturar audio de la sesión.";

// Cada cuánto se refresca el medidor y se mira si siguen llegando chunks.
const LATIDO_MS = 250;

export function useGrabador({ claveGrabacion, esPendiente, onListo, onError }: UseGrabadorOpciones): Grabador {
  const [estado, setEstado] = React.useState<EstadoGrabador>("inactivo");
  const [segundos, setSegundos] = React.useState(0);
  const [hueco, setHueco] = React.useState<AvisoHueco | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = React.useState(false);
  const [avisoLimite, setAvisoLimite] = React.useState(false);
  const guarda = useGuardaDeToque();
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);
  const [muyCorta, setMuyCorta] = React.useState(false);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const medidaRef = React.useRef<Medida>(medidaInicial(0));
  // Todo lo que se MIDE usa este reloj, que no retrocede. Date.now() queda sólo
  // para las horas que se guardan (pausas y eventos).
  const relojRef = React.useRef<() => number>(() => Date.now());
  const pausasRef = React.useRef<Pausa[]>([]);
  const eventosRef = React.useRef<EventoGrabacion[]>([]);
  const mimeTypeRef = React.useRef("audio/webm");
  // Terminar pidió el stop: `onstop` entrega. Cualquier otro stop no entrega.
  const entregarAlDetenerRef = React.useRef(false);
  // Desde cuándo está en pausa el recorder. Un chunk que llega en pausa (el
  // resto que entrega pause() o stop()) sólo trae audio anterior a ese momento.
  const pausadoEnRef = React.useRef<number | null>(null);
  const limiteRef = React.useRef(false);
  const latidoRef = React.useRef<number | null>(null);
  const ultimoLatidoRef = React.useRef(0);
  const estadoRef = React.useRef<EstadoGrabador>("inactivo");
  const claveRef = React.useRef<string | null>(claveGrabacion);
  const onErrorRef = React.useRef(onError);
  const onListoRef = React.useRef(onListo);

  React.useEffect(() => {
    onErrorRef.current = onError;
    onListoRef.current = onListo;
  }, [onError, onListo]);

  React.useEffect(() => {
    // La clave del prop sólo se adopta sin grabación en curso: los chunks ya
    // guardados siguen bajo la clave con la que se abrió.
    if (estadoRef.current === "inactivo" && claveGrabacion) {
      claveRef.current = claveGrabacion;
    }
  }, [claveGrabacion]);

  function cambiarEstado(nuevo: EstadoGrabador) {
    estadoRef.current = nuevo;
    setEstado(nuevo);
  }

  const anotar = React.useCallback((tipo: EventoGrabacion["tipo"], ms?: number) => {
    if (eventosRef.current.length >= MAX_EVENTOS_GRABACION) return;
    eventosRef.current.push({ t: new Date().toISOString(), tipo, ...(ms === undefined ? {} : { ms: Math.round(ms) }) });
  }, []);

  const limpiarLatido = React.useCallback(() => {
    if (latidoRef.current !== null) {
      window.clearInterval(latidoRef.current);
      latidoRef.current = null;
    }
  }, []);

  const microfono = useMicrofono(anotar);
  const { soltar: soltarMicrofono } = microfono;

  function volverAInactivo() {
    limpiarLatido();
    soltarMicrofono();
    recorderRef.current = null;
    chunksRef.current = [];
    pausasRef.current = [];
    eventosRef.current = [];
    entregarAlDetenerRef.current = false;
    limiteRef.current = false;
    pausadoEnRef.current = null;
    setSegundos(0);
    microfono.reiniciar();
    setHueco(null);
    setLimiteAlcanzado(false);
    setAvisoLimite(false);
    setMensajeError(null);
    cambiarEstado("inactivo");
  }

  function irAError(mensaje: string) {
    volverAInactivo();
    setMensajeError(mensaje);
    cambiarEstado("error");
    onErrorRef.current(mensaje);
  }

  /** Arma el archivo y lo entrega. Blob de Blobs: no copia el audio. */
  function entregar(chunks: Blob[], mimeType: string, duracionSegundos: number, pausas: Pausa[]) {
    limpiarLatido();
    soltarMicrofono();
    recorderRef.current = null;
    const audioBlob = new Blob(chunks, { type: mimeType });

    if (audioBlob.size === 0) {
      irAError(GRABACION_VACIA);
      return;
    }

    cambiarEstado("entregada");
    // Los chunks de IndexedDB los borra la pantalla, recién con la subida
    // confirmada: si falla, siguen siendo recuperables.
    onListoRef.current({
      audioBlob,
      duracionSegundos: Math.min(LIMITE_SEGUNDOS, Math.max(1, Math.round(duracionSegundos))),
      pausas: aRegistradas(pausas),
      diagnostico: { eventos: eventosRef.current, chunks: chunks.length, bytes: audioBlob.size },
    });
  }

  function cerrarPausaAbierta() {
    const abierta = pausasRef.current[pausasRef.current.length - 1];
    if (!abierta || abierta.fin !== null) return;
    pausasRef.current = [...pausasRef.current.slice(0, -1), { inicio: abierta.inicio, fin: Date.now() }];
    if (claveRef.current) void guardarPausas(claveRef.current, pausasRef.current);
  }

  /** Pausa el MISMO recorder. La usan la pausa manual y el tope. */
  function pausarRecorder(tipo: "pausa" | "limite") {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return false;
    try {
      recorder.pause();
    } catch {
      return false;
    }
    anotar(tipo);
    pausadoEnRef.current = relojRef.current();
    pausasRef.current = [...pausasRef.current, { inicio: Date.now(), fin: null }];
    if (claveRef.current) void guardarPausas(claveRef.current, pausasRef.current);
    microfono.aquietar();
    cambiarEstado("pausado");
    return true;
  }

  /** El micrófono se fue de verdad. Seguir exigiría otro recorder, y eso no
   *  se hace: la grabación termina acá con todo lo que llegó. */
  function terminarPorFalla(tipo: "pista-terminada" | "error-recorder") {
    if (estadoRef.current !== "grabando" && estadoRef.current !== "pausado") return;
    anotar(tipo);
    cerrarPausaAbierta();
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch {
      // Ya estaba muerto.
    }
    limpiarLatido();
    soltarMicrofono();
    microfono.reiniciar();
    cambiarEstado("terminada");
  }

  function iniciarLatido() {
    limpiarLatido();
    ultimoLatidoRef.current = relojRef.current();
    latidoRef.current = window.setInterval(() => {
      const ahora = relojRef.current();
      const salto = ahora - ultimoLatidoRef.current;
      ultimoLatidoRef.current = ahora;
      // La página no corrió: queda anotado. No corta nada.
      if (salto > HUECO_MS) anotar("hueco-latido", salto);
      if (estadoRef.current !== "grabando") return;
      microfono.medir(ahora);
      // Dejó de llegar audio y todavía no volvió: se dice mientras dura.
      const desde = sinChunksDesde(medidaRef.current, ahora);
      if (desde !== null) setHueco((actual) => (actual?.desde === desde ? actual : { desde, hasta: null }));
    }, LATIDO_MS);
  }

  function alLlegarChunk(chunk: Blob) {
    if (chunk.size === 0) return;
    const antes = medidaRef.current;
    const medida = contarChunk(antes, chunk.size, pausadoEnRef.current ?? relojRef.current());
    medidaRef.current = medida;
    chunksRef.current.push(chunk);
    if (claveRef.current) {
      // Fire-and-forget: el respaldo en disco nunca bloquea la grabación.
      void guardarChunk(claveRef.current, medida.chunks - 1, chunk);
    }

    if (medida.huecos.length > antes.huecos.length) {
      const nuevo = medida.huecos[medida.huecos.length - 1];
      anotar("hueco-chunks", nuevo.hasta - nuevo.desde);
      setHueco(nuevo);
    } else if (medida.ultimoChunkEn - medida.cubiertoHasta <= HUECO_MS) {
      // Un aviso abierto que el audio recibido terminó explicando se retira.
      setHueco((actual) => (actual && actual.hasta === null ? null : actual));
    }

    setSegundos(Math.min(LIMITE_SEGUNDOS, medida.segundos));
    const limite = estadoLimite(medida.segundos);
    setAvisoLimite(limite === "aviso");
    if (limite === "limite" && estadoRef.current === "grabando" && pausarRecorder("limite")) {
      limiteRef.current = true;
      setLimiteAlcanzado(true);
    }
  }

  // Al desmontar: soltar todo. Los chunks guardados quedan para recuperar.
  React.useEffect(() => {
    const alCambiarVisibilidad = () => {
      if (estadoRef.current === "grabando" || estadoRef.current === "pausado") {
        anotar(document.visibilityState === "visible" ? "visible" : "oculta");
      }
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      limpiarLatido();
      entregarAlDetenerRef.current = false;
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } catch {
        // Ya estaba detenido.
      }
      soltarMicrofono();
    };
  }, [anotar, limpiarLatido, soltarMicrofono]);

  const { pendiente, setPendiente, guardada, descartar: descartarPendiente } =
    useGrabacionPendiente(claveGrabacion, esPendiente, estadoRef, claveRef);

  async function iniciar(clave: string) {
    if (estadoRef.current !== "inactivo" && estadoRef.current !== "error") return;
    claveRef.current = clave;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      irAError("Tu navegador no soporta grabación de audio.");
      return;
    }

    volverAInactivo();
    setPendiente(null);
    setMuyCorta(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const recorder = crearMediaRecorder(stream);
      microfono.tomar(stream);
      recorderRef.current = recorder;
      mimeTypeRef.current = recorder.mimeType || "audio/webm";
      relojRef.current = crearReloj();
      medidaRef.current = medidaInicial(relojRef.current());
      // Registra el inicio y limpia chunks viejos del turno.
      void iniciarSesionGrabacion(clave, mimeTypeRef.current);

      recorder.ondataavailable = (event: BlobEvent) => alLlegarChunk(event.data);
      recorder.onerror = () => terminarPorFalla("error-recorder");
      recorder.onstop = () => {
        if (!entregarAlDetenerRef.current) return;
        entregarAlDetenerRef.current = false;
        cerrarPausaAbierta();
        entregar(chunksRef.current, mimeTypeRef.current, medidaRef.current.segundos, pausasRef.current);
      };

      microfono.escuchar(stream, () => terminarPorFalla("pista-terminada"));
      recorder.start(TIMESLICE_MS);
      cambiarEstado("grabando");
      iniciarLatido();
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
    }
  }

  function pausar() {
    if (estadoRef.current !== "grabando" || guarda.activa.current) return;
    if (pausarRecorder("pausa")) guarda.tocar();
  }

  function reanudar() {
    const recorder = recorderRef.current;
    if (estadoRef.current !== "pausado" || guarda.activa.current || limiteRef.current) return;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
    } catch {
      return;
    }
    guarda.tocar();
    anotar("reanudar");
    pausadoEnRef.current = null;
    cerrarPausaAbierta();
    // El rato en pausa no es un hueco.
    medidaRef.current = reanudarMedida(medidaRef.current, relojRef.current());
    microfono.olvidarSilencio();
    cambiarEstado("grabando");
  }

  /** Un toque accidental: se tira lo grabado, en el teléfono y en memoria, y
   *  la pantalla vuelve a ofrecer Grabar. Al servidor no llega nada: la sesión
   *  sigue en "grabando", que es justo el estado desde el que se graba. */
  function descartarPorCorta() {
    descartar();
    setMuyCorta(true);
  }

  function terminar() {
    const actual = estadoRef.current;

    if ((actual === "grabando" || actual === "pausado" || actual === "terminada") && medidaRef.current.segundos < MINIMO_SEGUNDOS) {
      descartarPorCorta();
      return;
    }

    if (actual === "terminada") {
      cambiarEstado("preparando");
      entregar(chunksRef.current, mimeTypeRef.current, medidaRef.current.segundos, pausasRef.current);
      return;
    }

    if (actual !== "grabando" && actual !== "pausado") return;

    cambiarEstado("preparando");
    limpiarLatido();
    entregarAlDetenerRef.current = true;
    try {
      recorderRef.current?.stop();
    } catch {
      irAError("No se pudo detener la grabación.");
    }
  }

  function descartar() {
    if (claveRef.current) void limpiarGrabacion(claveRef.current);
    entregarAlDetenerRef.current = false;
    try {
      // stop() entrega un último trozo: sin oyente, para que no vuelva a
      // escribirse en el teléfono lo que se acaba de borrar.
      if (recorderRef.current) recorderRef.current.ondataavailable = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch {
      // Ya estaba detenido.
    }
    volverAInactivo();
  }

  function enviarPendiente() {
    if (!pendiente || estadoRef.current !== "inactivo") return;
    if (pendiente.duracionAproxSeg < MINIMO_SEGUNDOS) {
      descartarPendiente();
      setMuyCorta(true);
      return;
    }
    claveRef.current = pendiente.sesionClinicaId; // la suya, no la del prop
    setPendiente(null);
    cambiarEstado("preparando");
    eventosRef.current = [];
    anotar("recuperada");
    setSegundos(pendiente.duracionAproxSeg);
    entregar(pendiente.chunks, pendiente.mimeType, pendiente.duracionAproxSeg, pendiente.pausas);
  }

  return {
    estado,
    segundos,
    nivelAudio: microfono.nivelAudio,
    audioSilencioso: microfono.audioSilencioso,
    microfonoSilenciado: microfono.microfonoSilenciado,
    hueco,
    limiteAlcanzado,
    avisoLimite,
    conmutando: guarda.conmutando,
    mensajeError,
    muyCorta,
    pendienteSeg: pendiente ? pendiente.duracionAproxSeg : null,
    pendiente: guardada,
    iniciar,
    pausar,
    reanudar,
    terminar,
    descartar,
    cerrarAvisoHueco: () => setHueco(null),
    enviarPendiente,
    descartarPendiente,
    anotar,
    resetear: volverAInactivo,
  };
}

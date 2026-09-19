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

import { aRegistradas, formatearDuracion, type PausaRegistrada } from "@/lib/grabacion-cronometro";
import { crearMediaRecorder, mensajeErrorGrabacion } from "@/lib/grabacion-microfono";
import {
  AVISO_LIMITE_SEGUNDOS,
  contarChunk,
  crearReloj,
  estadoLimite,
  HUECO_MS,
  LIMITE_SEGUNDOS,
  medidaInicial,
  MINIMO_SEGUNDOS,
  reanudarMedida,
  SILENCIO_AVISO_SEG,
  sinChunksDesde,
  TIMESLICE_MS,
  type Medida,
} from "@/lib/grabacion-captura";
import {
  guardarChunk,
  guardarPausas,
  iniciarSesionGrabacion,
  limpiarGrabacion,
  recuperarGrabacionPendiente,
  type GrabacionPendiente,
  type Pausa,
} from "@/lib/grabacion-storage";
import {
  MAX_EVENTOS_GRABACION,
  type DiagnosticoGrabacion,
  type EventoGrabacion,
} from "@/lib/sesion-clinica/schema";

export type { Pausa, PausaRegistrada };
export { formatearDuracion, AVISO_LIMITE_SEGUNDOS, LIMITE_SEGUNDOS };

/** Lo que recibe la pantalla para subir. El Blob se sube tal cual. */
export interface DatosGrabacion {
  audioBlob: Blob;
  /** Segundos de audio recibido, medidos en el teléfono. */
  duracionSegundos: number;
  pausas: PausaRegistrada[];
  diagnostico: DiagnosticoGrabacion;
}

/**
 *   inactivo   → grabando     (iniciar)
 *   grabando   ⇄ pausado      (pausar / reanudar; el tope pausa solo)
 *   grabando/pausado → terminada   (la pista terminó o el recorder falló)
 *   grabando/pausado/terminada → preparando → entregada   (terminar)
 *   inactivo   → preparando → entregada   (enviarPendiente)
 *   cualquiera → inactivo     (descartar / resetear)
 */
export type EstadoGrabador =
  | "inactivo"
  | "grabando"
  | "pausado"
  | "terminada"
  | "preparando"
  | "entregada"
  | "error";

/** Un rato sin audio. `hasta` es null mientras todavía no volvió a llegar. */
export interface AvisoHueco {
  desde: number;
  hasta: number | null;
}

const GRABACION_VACIA = "No se pudo capturar audio de la sesión.";

// Cada cuánto se refresca el medidor y se mira si siguen llegando chunks.
const LATIDO_MS = 250;
// Debajo de este RMS (0-1) el medidor considera que no entra sonido.
const UMBRAL_SILENCIO = 0.012;
// Tras Pausar o Reanudar el botón no responde por este rato: un doble toque
// no puede reanudar dos veces ni volver a pausar lo que acaba de reanudar.
const GUARDA_TOQUE_MS = 800;

export interface UseGrabadorOpciones {
  /** Con qué se guardan los chunks: el turnoId (turno ↔ sesión es 1:1). */
  claveGrabacion: string | null;
  /** Recibe la grabación lista para subir. Una sola vez por grabación. */
  onListo: (datos: DatosGrabacion) => void;
  onError: (mensaje: string) => void;
}

export interface Grabador {
  estado: EstadoGrabador;
  /** Segundos de audio recibido. */
  segundos: number;
  /** 0-1, para el medidor. */
  nivelAudio: number;
  /** El medidor lleva SILENCIO_AVISO_SEG en cero con la pantalla a la vista. */
  audioSilencioso: boolean;
  /** El teléfono silenció el micrófono (una llamada). La grabación sigue. */
  microfonoSilenciado: boolean;
  /** Dejó de llegar audio; queda hasta que ella lo cierra. */
  hueco: AvisoHueco | null;
  limiteAlcanzado: boolean;
  avisoLimite: boolean;
  /** Pausar/Reanudar acaban de tocarse: el botón va deshabilitado. */
  conmutando: boolean;
  mensajeError: string | null;
  /** Se tocó Terminar con menos de MINIMO_SEGUNDOS grabados: no se guardó
   *  nada y se puede volver a grabar. Lo apaga el próximo Grabar. */
  muyCorta: boolean;
  /** Minutos aproximados de una grabación de este turno que quedó guardada. */
  pendienteSeg: number | null;
  iniciar: (clave: string) => Promise<void>;
  pausar: () => void;
  reanudar: () => void;
  terminar: () => void;
  descartar: () => void;
  cerrarAvisoHueco: () => void;
  enviarPendiente: () => void;
  descartarPendiente: () => void;
  /** La pantalla anota acá lo que sabe ella: el wake lock. */
  anotar: (tipo: EventoGrabacion["tipo"], ms?: number) => void;
  resetear: () => void;
}

export function useGrabador({ claveGrabacion, onListo, onError }: UseGrabadorOpciones): Grabador {
  const [estado, setEstado] = React.useState<EstadoGrabador>("inactivo");
  const [segundos, setSegundos] = React.useState(0);
  const [nivelAudio, setNivelAudio] = React.useState(0);
  const [audioSilencioso, setAudioSilencioso] = React.useState(false);
  const [microfonoSilenciado, setMicrofonoSilenciado] = React.useState(false);
  const [hueco, setHueco] = React.useState<AvisoHueco | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = React.useState(false);
  const [avisoLimite, setAvisoLimite] = React.useState(false);
  const [conmutando, setConmutando] = React.useState(false);
  const [mensajeError, setMensajeError] = React.useState<string | null>(null);
  const [muyCorta, setMuyCorta] = React.useState(false);
  const [pendiente, setPendiente] = React.useState<GrabacionPendiente | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
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
  const conmutandoRef = React.useRef(false);
  const limiteRef = React.useRef(false);
  const latidoRef = React.useRef<number | null>(null);
  const ultimoLatidoRef = React.useRef(0);
  const silencioDesdeRef = React.useRef<number | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analizadorRef = React.useRef<AnalyserNode | null>(null);
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

  const soltarMicrofono = React.useCallback(() => {
    analizadorRef.current = null;
    silencioDesdeRef.current = null;
    const contexto = audioContextRef.current;
    audioContextRef.current = null;
    void contexto?.close().catch(() => {});

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    }
    streamRef.current = null;
  }, []);

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
    setNivelAudio(0);
    setAudioSilencioso(false);
    setMicrofonoSilenciado(false);
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
    setNivelAudio(0);
    setAudioSilencioso(false);
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
    setNivelAudio(0);
    setAudioSilencioso(false);
    setMicrofonoSilenciado(false);
    cambiarEstado("terminada");
  }

  function guardaDeToque() {
    conmutandoRef.current = true;
    setConmutando(true);
    window.setTimeout(() => {
      conmutandoRef.current = false;
      setConmutando(false);
    }, GUARDA_TOQUE_MS);
  }

  function conectarMedidor(stream: MediaStream) {
    const Constructor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    try {
      const contexto = new Constructor();
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      contexto.createMediaStreamSource(stream).connect(analizador);
      void contexto.resume().catch(() => {});
      audioContextRef.current = contexto;
      analizadorRef.current = analizador;
    } catch {
      // Sin medidor se graba igual.
    }
  }

  /** Sólo pinta: el nivel y el aviso visible de silencio. No decide nada. */
  function medirNivel(ahora: number) {
    const analizador = analizadorRef.current;
    if (!analizador || audioContextRef.current?.state !== "running") {
      silencioDesdeRef.current = null;
      setAudioSilencioso(false);
      return;
    }
    const muestra = new Uint8Array(analizador.fftSize);
    analizador.getByteTimeDomainData(muestra);
    let suma = 0;
    for (const valor of muestra) suma += ((valor - 128) / 128) ** 2;
    const rms = Math.sqrt(suma / muestra.length);
    setNivelAudio(Math.min(1, rms * 6));
    silencioDesdeRef.current = rms < UMBRAL_SILENCIO ? (silencioDesdeRef.current ?? ahora) : null;
    setAudioSilencioso(
      document.visibilityState === "visible" &&
        silencioDesdeRef.current !== null &&
        ahora - silencioDesdeRef.current >= SILENCIO_AVISO_SEG * 1000,
    );
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
      medirNivel(ahora);
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

  // Una grabación de este turno que quedó en el teléfono (el navegador mató
  // la página). No se puede continuar —haría falta otro recorder—: se ofrece
  // enviarla o descartarla.
  React.useEffect(() => {
    if (!claveGrabacion) return;
    let cancelado = false;
    void recuperarGrabacionPendiente().then((recuperada) => {
      if (cancelado || !recuperada || recuperada.sesionClinicaId !== claveGrabacion) return;
      if (estadoRef.current !== "inactivo") return;
      setPendiente(recuperada);
    });
    return () => {
      cancelado = true;
    };
  }, [claveGrabacion]);

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
      streamRef.current = stream;
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

      const pista = stream.getAudioTracks()[0];
      if (pista) {
        pista.onended = () => terminarPorFalla("pista-terminada");
        // Una llamada entrante silencia la pista. El recorder sigue y graba
        // silencio: es el mismo archivo, y al cortar la llamada vuelve solo.
        pista.onmute = () => {
          anotar("mute");
          setMicrofonoSilenciado(true);
        };
        pista.onunmute = () => {
          anotar("unmute");
          setMicrofonoSilenciado(false);
        };
      }

      conectarMedidor(stream);
      recorder.start(TIMESLICE_MS);
      cambiarEstado("grabando");
      iniciarLatido();
    } catch (error) {
      irAError(mensajeErrorGrabacion(error));
    }
  }

  function pausar() {
    if (estadoRef.current !== "grabando" || conmutandoRef.current) return;
    if (pausarRecorder("pausa")) guardaDeToque();
  }

  function reanudar() {
    const recorder = recorderRef.current;
    if (estadoRef.current !== "pausado" || conmutandoRef.current || limiteRef.current) return;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
    } catch {
      return;
    }
    guardaDeToque();
    anotar("reanudar");
    pausadoEnRef.current = null;
    cerrarPausaAbierta();
    // El rato en pausa no es un hueco.
    medidaRef.current = reanudarMedida(medidaRef.current, relojRef.current());
    silencioDesdeRef.current = null;
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
    setPendiente(null);
    cambiarEstado("preparando");
    eventosRef.current = [];
    anotar("recuperada");
    setSegundos(pendiente.duracionAproxSeg);
    entregar(pendiente.chunks, pendiente.mimeType, pendiente.duracionAproxSeg, pendiente.pausas);
  }

  function descartarPendiente() {
    setPendiente(null);
    if (claveRef.current) void limpiarGrabacion(claveRef.current);
  }

  return {
    estado,
    segundos,
    nivelAudio,
    audioSilencioso,
    microfonoSilenciado,
    hueco,
    limiteAlcanzado,
    avisoLimite,
    conmutando,
    mensajeError,
    muyCorta,
    pendienteSeg: pendiente ? pendiente.duracionAproxSeg : null,
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

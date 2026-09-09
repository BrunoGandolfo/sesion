"use client";

// Máquina de estados de la grabación clínica. SIN UI.
//
// Antes este archivo era 1.249 líneas: la lógica de captura convivía con una
// tarjeta que explicaba el cifrado, mostraba el id del turno y pedía dos
// toques ("Detener" y después "Enviar") para mandar el audio. La capa visual
// se mudó a la ruta /grabar/[turnoId].
//
// QUÉ QUEDA ACÁ Y QUÉ SE FUE
//
// Acá queda la máquina de estados: los refs, los efectos, el wake lock, el
// medidor de nivel y el orden en que se detiene, se mide y se limpia. Es la
// parte que no se puede probar sin renderizar un hook, y el proyecto no tiene
// (ni puede sumar en esta tanda) jsdom ni @testing-library.
//
// Lo que sí se puede probar solo se mudó a módulos propios, con sus tests:
//
//   - src/lib/grabacion-captura.ts     cuándo avisar y cuándo cortar
//   - src/lib/grabacion-cronometro.ts  cuánto se grabó y cómo se muestra
//   - src/lib/grabacion-microfono.ts   MediaRecorder y errores de permiso
//   - src/lib/grabacion-cifrado.ts     chunks → paquete cifrado
//   - src/lib/grabacion-storage.ts     backup en IndexedDB (ya estaba)
//
// Se re-exportan desde acá para no tocar a los consumidores: `grabar-view`
// importa `formatearDuracion` y `DatosGrabacion` de este módulo.
//
// Lo que la máquina sigue garantizando:
//
//   - captura por chunks de 1 s que forman UN único archivo (la pausa usa
//     MediaRecorder.pause(), no un recorder nuevo);
//   - backup incremental en IndexedDB desde el primer chunk, para sobrevivir
//     a que el navegador mate el proceso;
//   - recuperación de una grabación huérfana del mismo turno, incluida la
//     vuelta de bfcache tras un pagehide;
//   - wake lock mientras se graba.
//
// Y la regla que ordena todo lo demás, desde el 7/9: NINGUNA interrupción
// cierra la sesión sola. El micrófono que muere, el silencio prolongado, el
// tope de duración y la pantalla que se apaga terminan todos en
// "interrumpida", con el audio entero y la decisión de subir en manos de la
// profesional. El único camino a `onListo` que no arranca de un toque suyo
// no existe.
//
// El consumidor recibe el audio ya cifrado por `onListo` y se encarga de
// subirlo. Acá no hay fetch ni conocimiento de la API.

import * as React from "react";

import {
  aRegistradas,
  formatearDuracion,
  segundosGrabados,
  type PausaRegistrada,
} from "@/lib/grabacion-cronometro";
import {
  cifrarGrabacion,
  GrabacionVaciaError,
  type DatosGrabacion,
} from "@/lib/grabacion-cifrado";
import {
  crearMediaRecorder,
  mensajeErrorGrabacion,
} from "@/lib/grabacion-microfono";
import {
  AVISO_LIMITE_SEGUNDOS,
  estadoCaptura,
  estadoLimite,
  LIMITE_SEGUNDOS,
} from "@/lib/grabacion-captura";
import {
  guardarChunk,
  guardarPausas,
  iniciarSesionGrabacion,
  limpiarGrabacion,
  recuperarGrabacionPendiente,
  type Pausa,
} from "@/lib/grabacion-storage";

export type { Pausa, PausaRegistrada, DatosGrabacion };
export { formatearDuracion, segundosGrabados };
// El tope y su aviso viven en grabacion-captura.ts (son función pura y se
// testean ahí); se re-exportan para no romper a quien los importe de acá.
export { AVISO_LIMITE_SEGUNDOS, LIMITE_SEGUNDOS };

/**
 * Estados y transiciones:
 *
 *   inactivo    → grabando        (iniciar)
 *   grabando    → pausado         (pausar)
 *   pausado     → grabando        (reanudar)
 *   grabando    → interrumpida    (el micrófono murió o quedó muteado 3 s,
 *                                  se llegó a LIMITE_SEGUNDOS, o dejó de
 *                                  entrar sonido: ver MotivoInterrupcion)
 *   pausado     → interrumpida    (idem)
 *   inactivo    → interrumpida    (volvió de bfcache: los chunks se releen
 *                                  de IndexedDB, ver restaurarTrasPageHide)
 *   interrumpida→ grabando        (reanudarTrasInterrupcion)
 *   grabando    → cifrando        (terminar)
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

export interface GrabacionPendienteUI {
  chunks: Blob[];
  duracionAproxSeg: number;
  pausas: Pausa[];
}

// "pausar" = detención que preserva los chunks (pausa manual no la usa: ahí
// el recorder sigue vivo). Solo la interrupción del micrófono llega acá.
type ModoDetencion = "completar" | "descartar" | "pausar";

// Si el track de audio queda muteado más de este tiempo (Android le quitó el
// micrófono a Chrome por una llamada, etc.), lo tratamos como interrupción.
const MUTE_INTERRUPCION_MS = 3000;

// Cada cuánto se refrescan cronómetro y nivel de audio.
const LATIDO_MS = 250;

// Debajo de este RMS (0-1) consideramos que no entra audio.
const UMBRAL_SILENCIO = 0.012;

/**
 * Por qué se interrumpió una grabación. Ninguno de los cuatro cierra la
 * sesión: los cuatro dejan el audio entero esperando decisión. Lo que cambia
 * es qué se le dice a la profesional, porque no se resuelven igual — volver a
 * pedir el micrófono no arregla haber llegado al tope de duración.
 */
export type MotivoInterrupcion =
  | "microfono"
  | "limite"
  | "sin-sonido"
  | "pantalla";

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
  /** true cuando hace SILENCIO_VISIBLE_AVISO_SEG que no entra sonido y la
   *  pantalla está a la vista. Es un aviso, no un corte. */
  audioSilencioso: boolean;
  /** false si el navegador no soporta wake lock, si el request rechazó o si
   *  el SO lo soltó. Mezcla los tres casos: para avisar en pantalla usá
   *  `wakeLockSoltado`, que solo marca el tercero. */
  wakeLockActivo: boolean;
  /** El SO soltó un wake lock que teníamos: la pantalla se apagó. Es lo único
   *  que la profesional puede corregir, y lo único que se le muestra. */
  wakeLockSoltado: boolean;
  mensajeError: string | null;
  /** La grabación llegó a LIMITE_SEGUNDOS. No completa: interrumpe. */
  limiteAlcanzado: boolean;
  /** Falta poco para el tope (AVISO_LIMITE_SEGUNDOS). */
  avisoLimite: boolean;
  /** Por qué se interrumpió. null mientras el estado no sea "interrumpida". */
  motivoInterrupcion: MotivoInterrupcion | null;
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
  const [avisoLimite, setAvisoLimite] = React.useState(false);
  const [motivoInterrupcion, setMotivoInterrupcion] =
    React.useState<MotivoInterrupcion | null>(null);
  const [pendiente, setPendiente] =
    React.useState<GrabacionPendienteUI | null>(null);
  const [pausas, setPausas] = React.useState<PausaRegistrada[]>([]);
  // false cuando el navegador no soporta wake lock, el request rechazó o el SO
  // lo soltó (evento "release").
  const [wakeLockActivo, setWakeLockActivo] = React.useState(true);
  // Solo el tercer caso: teníamos un lock y el SO lo soltó. Es el que se
  // muestra — decirle "mantené la pantalla encendida" a alguien cuyo
  // navegador no tiene la API sería mentirle sobre la causa.
  const [wakeLockSoltado, setWakeLockSoltado] = React.useState(false);

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
  // Cuándo llegó el último chunk del MediaRecorder. Es la segunda evidencia
  // de que entra audio, y la que importa con la pantalla apagada: ahí el
  // AudioContext puede quedar suspendido y el analizador devolver siempre la
  // misma muestra, así que el RMS solo no alcanza para darse cuenta.
  const ultimoChunkRef = React.useRef<number | null>(null);
  const mimeTypeRef = React.useRef("audio/webm");
  const modoDetencionRef = React.useRef<ModoDetencion>("descartar");
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analizadorRef = React.useRef<AnalyserNode | null>(null);
  const muestraRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);
  const wakeLockReleaseHandlerRef = React.useRef<(() => void) | null>(null);
  const estadoRef = React.useRef<EstadoGrabador>("inactivo");
  // Se levanta en `pagehide` si había algo recuperable, y lo baja `pageshow`
  // al restaurar. Sin esto, volver de bfcache tras un descarte deliberado
  // resucitaría una grabación que ella ya tiró.
  const cortadaPorPageHideRef = React.useRef(false);
  // `pageshow` llegó antes de que el recorder terminara de detenerse. La
  // restauración queda anotada acá y la ejecuta `onstop`. Ver el comentario
  // de restaurarTrasPageHide: son dos disparadores para una sola función.
  const restauracionPendienteRef = React.useRef(false);
  const componenteMontadoRef = React.useRef(true);
  const claveRef = React.useRef<string | null>(claveGrabacion);
  const onErrorRef = React.useRef(onError);
  const onListoRef = React.useRef(onListo);
  const detenerActivaRef = React.useRef<(modo: ModoDetencion) => void>(() => {});
  const manejarInterrupcionRef = React.useRef<(motivo: MotivoInterrupcion) => void>(
    () => {},
  );
  const restaurarTrasPageHideRef = React.useRef<() => void>(() => {});

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
  const marcarWakeLock = React.useCallback(
    (activo: boolean, soltadoPorElSO = false) => {
      if (componenteMontadoRef.current) {
        setWakeLockActivo(activo);
        // Solo el "release" del SO enciende el aviso; cualquier otra cosa
        // (lo conseguimos, lo soltamos nosotros) lo apaga.
        setWakeLockSoltado(soltadoPorElSO);
      }
    },
    [],
  );

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
        marcarWakeLock(false, true);
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

  /**
   * Hace cuántos segundos que no hay evidencia de que entre audio.
   *
   * Son dos relojes y vale el más viejo, porque los dos fallan distinto:
   *
   *   - el RMS del analizador no sirve con la pantalla apagada (el
   *     AudioContext se suspende y la muestra queda congelada);
   *   - la sequía de chunks no distingue silencio de sonido, pero sí detecta
   *     que el MediaRecorder dejó de entregar.
   *
   * Los dos en cero mientras entra audio normal. Ambos son timestamps, así
   * que la cuenta sigue siendo correcta aunque el navegador haya frenado el
   * latido en segundo plano: al volver, la resta da el tiempo real.
   */
  function desdeCuandoSinAudio(): number | null {
    const relojes = [silencioDesdeRef.current, ultimoChunkRef.current].filter(
      (desde): desde is number => desde !== null,
    );

    return relojes.length === 0 ? null : Math.min(...relojes);
  }

  function segundosSinAudio(ahora: number) {
    const desde = desdeCuandoSinAudio();

    return desde === null ? 0 : Math.max(0, Math.floor((ahora - desde) / 1000));
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

  /**
   * Abre una pausa. `inicio` existe para las interrupciones por falta de
   * sonido: ahí la pausa empezó cuando dejó de entrar audio, no cuando nos
   * dimos cuenta un minuto después. Sin esto, esos minutos mudos viajarían
   * al worker como duración grabada.
   *
   * `segundosGrabados` recorta los tramos anteriores al inicio de la
   * grabación, así que un timestamp viejo de más no rompe la cuenta.
   */
  function abrirPausa(inicio: number = Date.now()) {
    pausasRef.current = [...pausasRef.current, { inicio, fin: null }];
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
    silencioDesdeRef.current = null;
    ultimoChunkRef.current = null;
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
      setMotivoInterrupcion(null);
      setAvisoLimite(false);
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
      setAvisoLimite(false);
      setMotivoInterrupcion(null);
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
      irAError(new GrabacionVaciaError().message);
      return;
    }

    cambiarEstado("cifrando");

    if (componenteMontadoRef.current) {
      setSegundos(duracionSegundos);
      setNivelAudio(0);
      setAudioSilencioso(false);
      setAvisoLimite(false);
      setMotivoInterrupcion(null);
    }

    try {
      const datos = await cifrarGrabacion({
        chunks,
        mimeType,
        duracionSegundos,
        pausas: pausasFinales,
      });

      if (componenteMontadoRef.current) {
        setMensajeError(null);
      }

      cambiarEstado("entregada");
      // Los chunks persistidos se limpian recién tras la confirmación de la
      // subida (lo hace la pantalla): si falla, siguen siendo recuperables.
      onListoRef.current(datos);
    } catch (error) {
      // Dos mensajes distintos porque son dos problemas distintos: sin audio
      // no hay nada que reintentar; un fallo de cifrado sí se reintenta.
      irAError(
        error instanceof GrabacionVaciaError
          ? error.message
          : "No se pudo cifrar el audio. Probá de nuevo.",
      );
    }
  }

  // Algo cortó la captura: el micrófono murió, quedó muteado demasiado
  // tiempo, dejó de entrar sonido, o se llegó al tope de duración. Se detiene
  // el recorder SIN descartar nada y SIN completar: los chunks en RAM y en
  // IndexedDB se preservan, y la grabación queda esperando que ella decida
  // entre reanudar y terminar.
  //
  // Es el único final automático que tiene la máquina. Que el corte por
  // LIMITE_SEGUNDOS entre por acá y no por `terminar` es exactamente el
  // arreglo del 7/9: ninguna interrupción sube nada sola.
  function manejarInterrupcion(motivo: MotivoInterrupcion) {
    if (estadoRef.current !== "grabando" && estadoRef.current !== "pausado") {
      return;
    }

    // Una interrupción cuenta como pausa (el cronómetro se detiene igual);
    // si ya había una pausa manual abierta, esa sigue siendo la abierta.
    if (estadoRef.current === "grabando") {
      // Por falta de sonido la pausa se retrotrae al último audio que entró:
      // los minutos mudos no son tiempo grabado y no tienen por qué contarse
      // como tal. Los otros tres motivos cortan en el momento.
      abrirPausa(
        motivo === "sin-sonido"
          ? (desdeCuandoSinAudio() ?? Date.now())
          : Date.now(),
      );
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
      setMotivoInterrupcion(motivo);
      setLimiteAlcanzado(motivo === "limite");
      setAvisoLimite(false);
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
      manejarInterrupcionRef.current("microfono");
    };

    pista.onmute = () => {
      limpiarMuteTimeout();
      muteTimeoutRef.current = window.setTimeout(() => {
        muteTimeoutRef.current = null;
        manejarInterrupcionRef.current("microfono");
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

  // Mide el nivel y lleva el reloj de silencio. NO decide nada: qué hacer con
  // ese silencio lo dice `estadoCaptura`, y lo aplica el latido.
  //
  // Si no hay analizador (el navegador no expone AudioContext) el reloj queda
  // en null y nunca se interrumpe por silencio: el medidor es best-effort y
  // no puede ser la razón por la que se corta una sesión.
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

    if (rms < UMBRAL_SILENCIO) {
      silencioDesdeRef.current = silencioDesdeRef.current ?? Date.now();
      return;
    }

    silencioDesdeRef.current = null;
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
        ultimoChunkRef.current = Date.now();
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
      manejarInterrupcionRef.current("microfono");
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

      // Si `pageshow` llegó mientras el recorder se estaba deteniendo, dejó
      // la restauración anotada: recién ahora el estado es "inactivo" y se
      // puede releer lo persistido.
      if (restauracionPendienteRef.current && cortadaPorPageHideRef.current) {
        restaurarTrasPageHideRef.current();
      }
    };

    vigilarPistaDeAudio(stream);
    conectarAnalisis(stream);
    // El primer chunk tarda un timeslice: se arranca el reloj ahora para que
    // ese hueco inicial no cuente como falta de audio.
    ultimoChunkRef.current = Date.now();
    recorder.start(1000);
  }

  // El latido es lo único que corre solo mientras se graba, y por eso es
  // donde se decide todo lo automático. Las dos decisiones que toma —el tope
  // de duración y la falta de sonido— terminan en el MISMO lugar:
  // `manejarInterrupcion`. Ninguna cifra, ninguna sube, ninguna cierra la
  // sesión. Eso es lo que cambió después del 7/9.
  //
  // Las cuentas viven en grabacion-captura.ts y se testean ahí; acá solo se
  // aplica lo que esas dos funciones puras devuelven.
  function iniciarLatido() {
    limpiarLatido();

    intervaloRef.current = window.setInterval(() => {
      if (estadoRef.current !== "grabando") {
        return;
      }

      medirNivel();

      const ahora = Date.now();
      const transcurridos = calcularSegundos();
      const limite = estadoLimite(transcurridos);

      if (limite === "limite") {
        manejarInterrupcion("limite");

        if (componenteMontadoRef.current) {
          // Después de manejarInterrupcion, que ya fijó los segundos: el
          // cronómetro se muestra clavado en el tope y no en 150:01.
          setSegundos(LIMITE_SEGUNDOS);
        }

        return;
      }

      const captura = estadoCaptura(
        segundosSinAudio(ahora),
        // El navegador puede no exponer document (no debería, pero el hook
        // corre en cliente y esto es barato): sin dato, se asume a la vista,
        // que es el criterio conservador — tarda más en cortar.
        typeof document === "undefined" || document.visibilityState === "visible",
      );

      if (captura === "interrumpir") {
        manejarInterrupcion("sin-sonido");
        return;
      }

      if (componenteMontadoRef.current) {
        setAvisoLimite(limite === "aviso");
        setAudioSilencioso(captura === "aviso");
        setSegundos(transcurridos);
      }
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

  /**
   * Vuelta de bfcache con una grabación que `pagehide` había cortado.
   *
   * `pagehide` descarta lo que vive en RAM porque el proceso puede morir; los
   * chunks quedan en IndexedDB. El problema es que si la página vuelve del
   * bfcache el componente NO se remonta, así que el efecto de recuperación
   * —que depende de `claveGrabacion`— no corre y la grabación queda muerta en
   * la pantalla previa, como si nunca hubiera existido.
   *
   * Acá se releen los chunks y se vuelve a "interrumpida": el audio entero,
   * el cronómetro donde estaba, y los dos botones de siempre. Igual que
   * cualquier otro corte, no se sube nada solo.
   *
   * DOS DISPARADORES, UNA SOLA FUNCIÓN
   *
   * `recorder.stop()` no deja el estado en "inactivo" de inmediato: eso pasa
   * en `onstop`, un turno después. Si `pageshow` llega en el medio —y llega,
   * porque las dos cosas las decide el navegador y no nosotros— el estado
   * todavía dice "grabando". Retirarse ahí era perder la grabación para
   * siempre, porque nadie volvía a intentar.
   *
   * Así que cuando el estado no está listo la restauración queda anotada y
   * `onstop` la ejecuta. Entra por `pageshow`, por `visibilitychange` o por
   * `onstop`, y las tres veces hace lo mismo o no hace nada.
   */
  function restaurarTrasPageHide() {
    if (!cortadaPorPageHideRef.current) {
      return;
    }

    // Ya está donde tiene que estar: el bfcache devolvió el estado intacto,
    // con sus chunks y sus dos botones. No hay nada que releer.
    if (estadoRef.current === "interrumpida") {
      cortadaPorPageHideRef.current = false;
      restauracionPendienteRef.current = false;
      return;
    }

    // El recorder todavía se está deteniendo. Se anota y se vuelve desde
    // `onstop`, que es quien deja el estado en "inactivo".
    if (estadoRef.current !== "inactivo") {
      restauracionPendienteRef.current = true;
      return;
    }

    cortadaPorPageHideRef.current = false;
    restauracionPendienteRef.current = false;

    const clave = claveRef.current;

    if (!clave) {
      return;
    }

    void recuperarGrabacionPendiente().then((recuperada) => {
      // Se vuelve a mirar el estado: entre el await y acá ella pudo haber
      // arrancado otra grabación o mandado la pendiente.
      if (
        !recuperada ||
        recuperada.sesionClinicaId !== clave ||
        recuperada.chunks.length === 0 ||
        estadoRef.current !== "inactivo"
      ) {
        return;
      }

      chunksRef.current = [...recuperada.chunks];
      chunkIndiceRef.current = recuperada.chunks.length;
      pausasRef.current = recuperada.pausas;
      // Lo recuperado se cuenta como base y el cronómetro arranca detenido:
      // no hay recorder vivo hasta que ella toque Reanudar.
      baseSegundosRef.current = recuperada.duracionAproxSeg;
      inicioGrabacionRef.current = null;
      modoDetencionRef.current = "descartar";
      silencioDesdeRef.current = null;
      ultimoChunkRef.current = null;

      if (componenteMontadoRef.current) {
        setPendiente(null);
        setSegundos(recuperada.duracionAproxSeg);
        setPausas(aRegistradas(recuperada.pausas));
        setNivelAudio(0);
        setAudioSilencioso(false);
        setMensajeError(null);
        setMotivoInterrupcion("pantalla");
      }

      cambiarEstado("interrumpida");
    });
  }

  React.useEffect(() => {
    restaurarTrasPageHideRef.current = restaurarTrasPageHide;
  });

  React.useEffect(() => {
    const onPageHide = () => {
      const previo = estadoRef.current;

      // Se anota que había algo recuperable ANTES de tocarlo: es lo que
      // distingue esta vuelta de un descarte deliberado. "interrumpida"
      // cuenta igual que una captura viva: tiene los mismos chunks y los
      // mismos dos botones esperando una decisión.
      cortadaPorPageHideRef.current =
        previo === "grabando" || previo === "pausado" || previo === "interrumpida";

      // En "interrumpida" no hay recorder que detener —`manejarInterrupcion`
      // ya lo soltó— y los chunks están en IndexedDB. Llamar a detenerActiva
      // acá solo llevaría el estado a "inactivo" y borraría de la pantalla
      // una grabación entera, sin dejar rastro de que existió.
      if (previo === "interrumpida") {
        return;
      }

      // Descarta lo que vive en RAM (el proceso puede morir), pero los chunks
      // ya persistidos en IndexedDB quedan: son la recuperación post-cierre.
      detenerActivaRef.current("descartar");
    };

    // `persisted` es la única señal de que volvimos del bfcache sin remontar.
    // Sin ella es una carga nueva, y de esa se encarga el efecto de
    // recuperación al montar.
    const onPageShow = (evento: PageTransitionEvent) => {
      if (evento.persisted) {
        restaurarTrasPageHideRef.current();
      }
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      componenteMontadoRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
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
      if (document.visibilityState !== "visible") {
        return;
      }

      if (estadoRef.current === "grabando" || estadoRef.current === "pausado") {
        void adquirirWakeLock();
        return;
      }

      // Segunda red para lo mismo que `pageshow`: hay navegadores que
      // restauran la página sin disparar pageshow con `persisted`. La función
      // es idempotente (baja la bandera al entrar), así que no molesta si los
      // dos caminos se disparan.
      restaurarTrasPageHideRef.current();
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
      setAvisoLimite(false);
      setMotivoInterrupcion(null);
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
      cortadaPorPageHideRef.current = false;
      restauracionPendienteRef.current = false;

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

    // Durante la pausa el recorder no emitió chunks: si no se reinicia el
    // reloj, el primer latido después de reanudar leería toda la pausa como
    // falta de audio y cortaría sin motivo.
    ultimoChunkRef.current = Date.now();
    silencioDesdeRef.current = null;

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

      // Una grabación restaurada de bfcache viene sin `inicio` (lo capturado
      // está todo en `base`): se repone ahora, para que el cronómetro vuelva
      // a correr desde lo que ya había.
      if (inicioGrabacionRef.current === null) {
        inicioGrabacionRef.current = Date.now();
        pausasRef.current = [];
      }

      // Se cierra la pausa justo antes de que el recorder vuelva a capturar:
      // el tramo sin micrófono no cuenta como tiempo grabado.
      cerrarPausa();
      conectarRecorder(stream);
      void adquirirWakeLock();

      if (componenteMontadoRef.current) {
        setMensajeError(null);
        setMotivoInterrupcion(null);
        setLimiteAlcanzado(false);
        setAudioSilencioso(false);
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
    wakeLockSoltado,
    mensajeError,
    limiteAlcanzado,
    avisoLimite,
    motivoInterrupcion,
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

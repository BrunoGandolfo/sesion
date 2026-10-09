"use client";

// El flujo de /grabar/[turnoId]: el orden de la pantalla y la conversación
// con la API, sin JSX.
//
// ARRANCAR A GRABAR NO DEPENDE DEL SERVIDOR (incidente del 9 de octubre de
// 2026: en modo avión, "Grabar sesión" decía "Algo falló" y no grababa,
// porque antes de abrir el micrófono se creaban el turno y la sesión).
//
//   Grabar  →  el micrófono, de inmediato, con una clave local: el turnoId o,
//   sin turno, `sin-turno:<paciente>:<inicio>` (lib/grabacion-clave.ts)
//
//   Terminar (o Reintentar, o "Guardarla ahora")  →  crear el turno si no
//   había, con la hora en que EMPEZÓ la grabación  →  asegurar la sesión en
//   "grabando"  →  upload-url / PUT a R2 / upload-confirmar  →  el turno pasa
//   a realizado  →  ella toca "Volver a la ficha".
//
// Si algo de eso falla por red, la grabación queda en el teléfono (IndexedDB,
// con su clave) y la pantalla lo dice: se reintenta cuando vuelve la señal.
//
// La grabación misma (un solo MediaRecorder, chunks, pausa, IndexedDB,
// recuperación) es de useGrabador; la subida, de lib/subida-audio.ts.

import * as React from "react";

import {
  useGrabador,
  type DatosGrabacion,
  type EstadoGrabador,
} from "@/components/grabacion/GrabadorSesion";
import { usePantallaEncendida } from "@/hooks/usePantallaEncendida";
import { ApiClientError, apiGet, apiPost, mensajeParaElla } from "@/lib/api-client";
import { hora } from "@/lib/format";
import { claveSinTurno, esClaveSinTurnoDe, inicioDeClaveSinTurno, turnoDeLaGrabacion } from "@/lib/grabacion-clave";
import { asociarTurno, limpiarGrabacion } from "@/lib/grabacion-storage";
import { ESTADOS_SIN_TERMINAR } from "@/lib/sesion-clinica/estados";
import {
  marcarTurnoRealizado,
  subirAudio,
  volverAGrabando,
} from "@/lib/subida-audio";
import { esRechazoDefinitivo, esRechazoDelServidor, esSinConexion } from "./errores-grabacion";
import {
  ALGO_FALLO,
  AUDIO_NO_GUARDADO,
  GRABACION_SIN_CONEXION,
  SESION_EN_CAMINO,
  TURNO_NO_MARCADO,
} from "@/lib/glosario";

/** Duración por defecto del turno creado al vuelo. */
const DURACION_SIN_TURNO = 50;

export type Fase =
  | "previo"
  | "preparando"
  | "enviando"
  | "guardado"
  | "no-guardado"
  // El servidor rechazó la subida por algo que reintentar no arregla: se
  // dice por qué y se vuelve a la ficha.
  | "rechazada"
  // El audio ya está en R2 y la nota está en camino; lo único que falló es
  // marcar el turno como realizado. No se vuelve a la ficha hasta resolverlo.
  | "turno-sin-marcar";

type TurnoApi = { id: string; fecha: string };
type SesionApi = { id: string; estado: string };

/** Qué pantalla toca. La precedencia: lo que está subiendo, después el
 *  resultado de la subida, después la grabación en curso, el error del
 *  micrófono y, si no, la previa. Antes eran seis ternarios encadenados que
 *  mezclaban `fase` y el estado del grabador. */
export type Pantalla =
  | "enviando"
  | "llego"
  | "reintentar-subida"
  | "reintentar-turno"
  | "rechazada"
  | "grabando"
  | "error-mic"
  | "previa";

export function pantallaDe(fase: Fase, estadoGrabador: EstadoGrabador): Pantalla {
  if (estadoGrabador === "preparando" || fase === "enviando") return "enviando";
  if (fase === "guardado") return "llego";
  if (fase === "no-guardado") return "reintentar-subida";
  if (fase === "turno-sin-marcar") return "reintentar-turno";
  if (fase === "rechazada") return "rechazada";
  if (estadoGrabador === "grabando" || estadoGrabador === "pausado" || estadoGrabador === "terminada") {
    return "grabando";
  }
  if (estadoGrabador === "error") return "error-mic";
  return "previa";
}

interface OpcionesFlujo {
  /** null cuando la ruta es /grabar/nuevo?pacienteId=… */
  turnoId: string | null;
  /** El turno pasa a "realizado" al confirmar la subida solo si venía así. */
  turnoProgramado: boolean;
  horaTexto: string | null;
  pacienteId: string;
  avisar: (mensaje: string) => void;
}

export function useFlujoGrabacion({
  turnoId: turnoIdInicial,
  turnoProgramado,
  horaTexto: horaInicial,
  pacienteId,
  avisar,
}: OpcionesFlujo) {
  // La clave local de la grabación (ver arriba). Con turno es su id.
  const [clave, setClave] = React.useState(turnoIdInicial);
  const [horaTexto, setHoraTexto] = React.useState(horaInicial);
  const [fase, setFase] = React.useState<Fase>("previo");
  const [progreso, setProgreso] = React.useState<number | null>(null);
  const [errorPantalla, setErrorPantalla] = React.useState<string | null>(null);

  // La grabación del último intento: lo que hace posible "Reintentar" sin
  // volver a grabar. Los chunks siguen en IndexedDB hasta que la confirmación
  // responde OK.
  const audioRef = React.useRef<DatosGrabacion | null>(null);
  const turnoIdRef = React.useRef(turnoIdInicial);
  const claveRef = React.useRef(turnoIdInicial);
  // Cuándo empezó la grabación. Viaja al crear el turno (sin turno, es su
  // hora) y la sesión: el servidor acepta una grabación del día del turno
  // aunque llegue pasada la medianoche (plazo-grabacion.ts).
  const inicioRef = React.useRef<Date | null>(null);
  const sesionIdRef = React.useRef<string | null>(null);
  const turnoProgramadoRef = React.useRef(turnoProgramado);

  /**
   * Deja la sesión clínica del turno en estado "grabando" y devuelve su id.
   * Tolera reentrar con una sesión ya empezada (volvió atrás, se le cerró el
   * navegador) y una subida que quedó a medias. Se llama al subir, no al
   * empezar a grabar.
   */
  const asegurarSesion = React.useCallback(async (turno: string): Promise<string> => {
    let sesion = await apiGet<SesionApi | null>(
      `/api/sesion-clinica?turnoId=${turno}`,
    );

    if (!sesion) {
      const inicio = inicioRef.current;
      sesion = await apiPost<SesionApi>("/api/sesion-clinica", {
        turnoId: turno,
        ...(inicio ? { iniciadaEn: inicio.toISOString() } : {}),
      });
    }

    if (sesion.estado === "subiendo") {
      await volverAGrabando(sesion.id);
      return sesion.id;
    }

    if (sesion.estado !== "grabando") {
      throw new ApiClientError(SESION_EN_CAMINO, 409);
    }

    return sesion.id;
  }, []);

  /** El turno: el que había o uno nuevo con la hora de inicio, anotado en el
   *  teléfono para que un reintento no lo cree dos veces. */
  const asegurarTurno = React.useCallback(async (): Promise<string> => {
    if (turnoIdRef.current) return turnoIdRef.current;
    const claveLocal = claveRef.current;
    const inicio = inicioRef.current ?? (claveLocal ? inicioDeClaveSinTurno(claveLocal) : null);
    if (!inicio) throw new Error("grabación sin turno y sin hora de inicio");
    const creado = await apiPost<TurnoApi>("/api/turnos", {
      pacienteId,
      fecha: inicio.toISOString(),
      duracion: DURACION_SIN_TURNO,
      modalidad: "presencial",
      // Un turno que nace al grabar no pasa por la regla de choque: la
      // sesión ocurrió, y un solapamiento en la agenda no puede impedir
      // guardarla.
      alGrabar: true,
      iniciadaEn: inicio.toISOString(),
    });
    turnoIdRef.current = creado.id;
    turnoProgramadoRef.current = true;
    setHoraTexto(hora(new Date(creado.fecha)));
    if (claveLocal) await asociarTurno(claveLocal, creado.id);
    return creado.id;
  }, [pacienteId]);

  const subir = React.useCallback(
    async (datos: DatosGrabacion) => {
      audioRef.current = datos;

      setErrorPantalla(null);
      setProgreso(0);
      setFase("enviando");

      let turno: string | null = null;
      let sesionId: string | null = null;
      try {
        turno = await asegurarTurno();
        sesionId = await asegurarSesion(turno);
        sesionIdRef.current = sesionId;

        await subirAudio(sesionId, datos, (p: number) => setProgreso(p));

        audioRef.current = null;
        // Recién con la confirmación en la mano deja de hacer falta el backup.
        void limpiarGrabacion(claveRef.current ?? turno);

        if (turnoProgramadoRef.current) {
          try {
            await marcarTurnoRealizado(turno);
            turnoProgramadoRef.current = false;
          } catch (error) {
            // El audio ya está a salvo y la nota se está escribiendo: no se
            // pierde nada. Lo que falta es el estado del turno, y eso se
            // dice y se puede repetir, en vez de tragarlo.
            console.warn("[grabar] el turno no quedó realizado", error);
            setErrorPantalla(TURNO_NO_MARCADO);
            avisar(TURNO_NO_MARCADO);
            setFase("turno-sin-marcar");
            return;
          }
        }

        setFase("guardado");
      } catch (error) {
        console.warn("[grabar] falló la subida", error);
        // Sin red no se le pregunta nada al servidor: la grabación queda en
        // el teléfono y se reintenta cuando vuelva la señal.
        if (esSinConexion(error)) {
          setErrorPantalla(GRABACION_SIN_CONEXION);
          setFase("no-guardado");
          // Si la sesión llegó a quedar en "subiendo", que vuelva a "grabando"
          // (sin red no va a poder; el próximo intento lo resuelve igual).
          if (sesionId) await volverAGrabando(sesionId);
          return;
        }
        // El servidor no aceptó el turno o la sesión (la sesión ya se cerró,
        // el turno no es de hoy, falta la autorización): reintentar fallaría
        // igual. Se dice lo que contestó, que está escrito para ella. La
        // grabación sigue en el teléfono.
        if (!sesionId && esRechazoDefinitivo(error)) {
          setErrorPantalla(error.mensaje);
          setFase("rechazada");
          return;
        }
        // Lo que decide es el estado de la sesión, no el código: un 409 de
        // "no llegó" deja la sesión en grabando a propósito para reintentar,
        // y uno de upload-url con la sesión en subiendo se arregla volviendo
        // a grabando. Definitivo es que la sesión ya no admita audio (la
        // cerró el mantenimiento, quedó fallida por corta, ya se procesa):
        // reintentar fallaría igual cada vez. Si no se puede leer, se
        // reintenta como siempre.
        if (turno && esRechazoDelServidor(error)) {
          const sesion = await apiGet<SesionApi | null>(
            `/api/sesion-clinica?turnoId=${turno}`,
          ).catch(() => undefined);
          const admiteAudio =
            sesion === undefined ||
            (sesion !== null &&
              (ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(sesion.estado));
          if (!admiteAudio) {
            setErrorPantalla(error.message);
            setFase("rechazada");
            return;
          }
        }
        // Nada se borra: la grabación sigue en memoria y sus chunks en
        // IndexedDB. La sesión vuelve a "grabando" para repetir desde
        // upload-url con el mismo blob.
        setErrorPantalla(error instanceof ApiClientError ? mensajeParaElla(error) : AUDIO_NO_GUARDADO);
        setFase("no-guardado");
        if (sesionId) await volverAGrabando(sesionId);
      } finally {
        setProgreso(null);
      }
    },
    [avisar, asegurarTurno, asegurarSesion],
  );

  const onListo = React.useCallback(
    (datos: DatosGrabacion) => {
      void subir(datos);
    },
    [subir],
  );

  const onErrorGrabacion = React.useCallback((mensaje: string) => {
    avisar(mensaje);
  }, [avisar]);

  // Qué grabación guardada en el teléfono se ofrece acá: cualquiera de esta
  // paciente —la de este turno, una sin turno, o la de un turno de ayer que
  // no llegó a subir (la sesión nace al subir, así que sólo existe en el
  // teléfono)—. Se envía a SU turno, no al de la URL (enviarPendiente).
  const esPendiente = React.useCallback(
    (claveGuardada: string, turnoGuardado: string | null, pacienteGuardado: string | null) =>
      pacienteGuardado === pacienteId ||
      esClaveSinTurnoDe(pacienteId, claveGuardada) ||
      (turnoIdInicial !== null && turnoDeLaGrabacion(claveGuardada, turnoGuardado) === turnoIdInicial),
    [turnoIdInicial, pacienteId],
  );

  const grabador = useGrabador({
    claveGrabacion: clave,
    esPendiente,
    pacienteId,
    onListo,
    onError: onErrorGrabacion,
  });

  const enCursoAhora =
    grabador.estado === "grabando" || grabador.estado === "pausado" || grabador.estado === "terminada";
  const enviandoAhora = grabador.estado === "preparando" || fase === "enviando";
  // La pantalla encendida desde que entra hasta que la grabación llegó:
  // también mientras sube, que en dos horas de audio son varios minutos.
  const pantalla = usePantallaEncendida(fase !== "guardado", enCursoAhora || enviandoAhora, grabador.anotar);

  // Una grabación que quedó en el teléfono sólo se ofrece si la sesión todavía
  // la admite. Si ya está en procesando (o más allá) el audio llegó: la copia
  // local sobra y se borra, en vez de ofrecerse de nuevo para siempre.
  const { pendienteSeg, descartarPendiente } = grabador;
  // Se mira el turno de la grabación guardada, que puede no ser el de la URL.
  const guardada = grabador.pendiente ?? null;
  const turnoDeLaPendiente = guardada ? turnoDeLaGrabacion(guardada.clave, guardada.turnoId) : turnoIdInicial;
  React.useEffect(() => {
    if (pendienteSeg === null || !turnoDeLaPendiente) return;
    let cancelado = false;
    void apiGet<SesionApi | null>(`/api/sesion-clinica?turnoId=${turnoDeLaPendiente}`)
      .then((sesion) => {
        if (!cancelado && sesion && !(ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(sesion.estado)) descartarPendiente();
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
    // descartarPendiente se recrea en cada render; la condición es el dato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendienteSeg, turnoDeLaPendiente]);

  /** Grabar: el micrófono, ya. Nada de red: el turno y la sesión se piden
   *  al subir (ver arriba). */
  async function empezar() {
    setFase("preparando");
    setErrorPantalla(null);

    try {
      // Una grabación nueva es de ESTA pantalla, aunque se haya ofrecido otra.
      const turno = (turnoIdRef.current = turnoIdInicial);
      turnoProgramadoRef.current = turnoProgramado;
      const inicio = new Date();
      const claveNueva = turno ?? claveSinTurno(pacienteId, inicio);
      inicioRef.current = inicio;
      claveRef.current = claveNueva;
      setClave(claveNueva);
      if (!turno) setHoraTexto(hora(inicio));

      await grabador.iniciar(claveNueva);
      // iniciar() arranca el diagnóstico de cero: se repone lo que ya se
      // sabía de la pantalla encendida.
      grabador.anotar(pantalla.estado === "concedida" ? "wakelock-concedido" : "wakelock-rechazado");
      // Ya está grabando: si la grabación se descarta por corta, la pantalla
      // previa tiene que volver con el botón de Grabar activo.
      setFase("previo");
    } catch (error) {
      setFase("previo");
      avisar(mensajeParaElla(error));
    }
  }

  /** Una grabación que quedó en este teléfono: se envía tal cual. El turno
   *  (si era sin turno, con la hora en que empezó) y la sesión se piden al
   *  subir, como al terminar. */
  function enviarPendiente() {
    const guardada = grabador.pendiente ?? null;

    if (guardada) {
      // Va a SU turno: el de su clave, el que se le creó, o ninguno todavía
      // (sin turno: se crea al subir, con la hora en que empezó).
      const turno = turnoDeLaGrabacion(guardada.clave, guardada.turnoId);
      claveRef.current = guardada.clave;
      setClave(guardada.clave);
      turnoIdRef.current = turno;
      // Otro turno estaba programado o realizado: marcarlo realizado no daña.
      turnoProgramadoRef.current = turno === turnoIdInicial ? turnoProgramado : true;
      inicioRef.current = inicioDeClaveSinTurno(guardada.clave) ?? new Date(guardada.iniciadaEn);
      setHoraTexto(turno === turnoIdInicial ? horaInicial : hora(inicioRef.current));
    } else if (!turnoIdRef.current) {
      avisar(ALGO_FALLO);
      return;
    }

    grabador.enviarPendiente();
  }

  /** Repite solo el PATCH del turno: el audio ya está subido. */
  async function reintentarMarcarRealizado() {
    const turno = turnoIdRef.current;

    if (!turno) {
      avisar(ALGO_FALLO);
      return;
    }

    try {
      await marcarTurnoRealizado(turno);
      turnoProgramadoRef.current = false;
      setErrorPantalla(null);
      setFase("guardado");
    } catch (error) {
      console.warn("[grabar] el turno no quedó realizado", error);
      avisar(TURNO_NO_MARCADO);
    }
  }

  function reintentarSubida() {
    const datos = audioRef.current;

    if (!datos) {
      avisar(ALGO_FALLO);
      return;
    }

    void subir(datos);
  }

  /** Después de un error del micrófono, la previa otra vez. */
  function reintentarMicrofono() {
    grabador.resetear();
    setFase("previo");
  }

  return {
    horaTexto,
    fase,
    progreso,
    errorPantalla,
    grabador,
    pantalla,
    enCursoAhora,
    enviandoAhora,
    empezar,
    enviarPendiente,
    reintentarSubida,
    reintentarMarcarRealizado,
    reintentarMicrofono,
  };
}

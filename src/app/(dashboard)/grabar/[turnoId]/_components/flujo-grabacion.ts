"use client";

// El flujo de /grabar/[turnoId]: el orden de la pantalla y la conversación
// con la API, sin JSX.
//
//   crear turno (solo si no había)  →  asegurar la sesión clínica en
//   "grabando"  →  grabar  →  upload-url / PUT a R2 / upload-confirmar  →
//   el turno pasa a realizado  →  ella toca "Volver a la ficha".
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
import { limpiarGrabacion } from "@/lib/grabacion-storage";
import { ESTADOS_SIN_TERMINAR } from "@/lib/sesion-clinica/estados";
import {
  ErrorSubida,
  marcarTurnoRealizado,
  subirAudio,
  volverAGrabando,
} from "@/lib/subida-audio";
import {
  ALGO_FALLO,
  AUDIO_NO_GUARDADO,
  SESION_EN_CAMINO,
  TURNO_NO_MARCADO,
} from "@/lib/glosario";

/** Duración por defecto del turno creado al vuelo. */
const DURACION_SIN_TURNO = 50;

/** Un rechazo del servidor a la subida (409 o 422 al pedir la URL o al
 *  confirmar) PUEDE ser definitivo. El PUT a R2 no entra: un 4xx de R2 (una
 *  URL vencida) se arregla pidiendo otra. */
function esRechazoDelServidor(error: unknown): error is ErrorSubida {
  return (
    error instanceof ErrorSubida &&
    error.paso !== "put" &&
    (error.status === 409 || error.status === 422)
  );
}

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
  const [turnoId, setTurnoId] = React.useState(turnoIdInicial);
  const [horaTexto, setHoraTexto] = React.useState(horaInicial);
  const [fase, setFase] = React.useState<Fase>("previo");
  const [progreso, setProgreso] = React.useState<number | null>(null);
  const [errorPantalla, setErrorPantalla] = React.useState<string | null>(null);

  // La grabación del último intento: lo que hace posible "Reintentar" sin
  // volver a grabar. Los chunks siguen en IndexedDB hasta que la confirmación
  // responde OK.
  const audioRef = React.useRef<DatosGrabacion | null>(null);
  const turnoIdRef = React.useRef(turnoIdInicial);
  const sesionIdRef = React.useRef<string | null>(null);
  const turnoProgramadoRef = React.useRef(turnoProgramado);

  const subir = React.useCallback(
    async (datos: DatosGrabacion) => {
      const sesionId = sesionIdRef.current;
      const turno = turnoIdRef.current;

      audioRef.current = datos;

      if (!sesionId || !turno) {
        setErrorPantalla(ALGO_FALLO);
        setFase("no-guardado");
        return;
      }

      setErrorPantalla(null);
      setProgreso(0);
      setFase("enviando");

      try {
        await subirAudio(sesionId, datos, (p: number) => setProgreso(p));

        audioRef.current = null;
        // Recién con la confirmación en la mano deja de hacer falta el backup.
        void limpiarGrabacion(turno);

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
        // Lo que decide es el estado de la sesión, no el código: un 409 de
        // "no llegó" deja la sesión en grabando a propósito para reintentar,
        // y uno de upload-url con la sesión en subiendo se arregla volviendo
        // a grabando. Definitivo es que la sesión ya no admita audio (la
        // cerró el mantenimiento, quedó fallida por corta, ya se procesa):
        // reintentar fallaría igual cada vez. Si no se puede leer, se
        // reintenta como siempre.
        if (esRechazoDelServidor(error)) {
          const sesion = await apiGet<SesionApi | null>(
            `/api/sesion-clinica?turnoId=${turno}`,
          ).catch(() => undefined);
          const admiteAudio =
            sesion === undefined ||
            (sesion !== null &&
              (ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(sesion.estado));
          if (!admiteAudio) {
            // Se dice lo que contestó el servidor, que está escrito para
            // ella, y se vuelve a la ficha.
            setErrorPantalla(error.message);
            setFase("rechazada");
            return;
          }
        }
        // Nada se borra: la grabación sigue en memoria y sus chunks en
        // IndexedDB. La sesión vuelve a "grabando" para repetir desde
        // upload-url con el mismo blob.
        setErrorPantalla(AUDIO_NO_GUARDADO);
        setFase("no-guardado");
        await volverAGrabando(sesionId);
      } finally {
        setProgreso(null);
      }
    },
    [avisar],
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

  const grabador = useGrabador({
    claveGrabacion: turnoId,
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
  React.useEffect(() => {
    if (pendienteSeg === null || !turnoId) return;
    let cancelado = false;
    void apiGet<SesionApi | null>(`/api/sesion-clinica?turnoId=${turnoId}`)
      .then((sesion) => {
        if (!cancelado && sesion && !(ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(sesion.estado)) descartarPendiente();
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
    // descartarPendiente se recrea en cada render; la condición es el dato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendienteSeg, turnoId]);

  /**
   * Deja la sesión clínica del turno en estado "grabando" y devuelve su id.
   * Tolera reentrar a la pantalla con una sesión ya empezada (volvió atrás,
   * se le cerró el navegador) y una subida que quedó a medias.
   */
  async function asegurarSesion(turno: string): Promise<string> {
    let sesion = await apiGet<SesionApi | null>(
      `/api/sesion-clinica?turnoId=${turno}`,
    );

    if (!sesion) {
      sesion = await apiPost<SesionApi>("/api/sesion-clinica", {
        turnoId: turno,
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
  }

  async function empezar() {
    setFase("preparando");
    setErrorPantalla(null);

    try {
      let turno = turnoIdRef.current;

      if (!turno) {
        const creado = await apiPost<TurnoApi>("/api/turnos", {
          pacienteId,
          fecha: new Date().toISOString(),
          duracion: DURACION_SIN_TURNO,
          modalidad: "presencial",
          // Un turno que nace al grabar no pasa por la regla de choque: la
          // sesión está ocurriendo, y un solapamiento en la agenda no puede
          // impedir grabarla.
          alGrabar: true,
        });

        turno = creado.id;
        turnoIdRef.current = turno;
        turnoProgramadoRef.current = true;
        setTurnoId(turno);
        setHoraTexto(hora(new Date(creado.fecha)));
      }

      sesionIdRef.current = await asegurarSesion(turno);
      await grabador.iniciar(turno);
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

  /** Una grabación que quedó en este teléfono: se envía tal cual, sin pedir
   *  nada más que la sesión en "grabando". */
  async function enviarPendiente() {
    const turno = turnoIdRef.current;

    if (!turno) {
      avisar(ALGO_FALLO);
      return;
    }

    setFase("preparando");

    try {
      sesionIdRef.current = await asegurarSesion(turno);
      setFase("previo");
      grabador.enviarPendiente();
    } catch (error) {
      setFase("previo");
      avisar(mensajeParaElla(error));
    }
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

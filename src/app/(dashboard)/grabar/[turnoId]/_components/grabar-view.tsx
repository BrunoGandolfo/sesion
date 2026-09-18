"use client";

// Capa visual de la grabación. Toda la lógica (un solo MediaRecorder, chunks,
// pausa, IndexedDB, recuperación) vive en useGrabador; acá está el orden de
// la pantalla y la conversación con la API:
//
//   crear turno (solo si no había)  →  asegurar la sesión clínica en
//   "grabando"  →  grabar  →  upload-url / PUT a R2 / upload-confirmar  →
//   el turno pasa a realizado  →  ella toca "Volver a la ficha".
//
// Después de Terminar siempre hay algo que se mueve y un texto que dice en
// qué está. La pantalla no navega sola: que desapareciera a los 1,6 segundos
// se leía como "no subió".

import * as React from "react";
import type { VarianteToast } from "@/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  Sun,
} from "lucide-react";

import {
  formatearDuracion,
  useGrabador,
  type AvisoHueco,
  type DatosGrabacion,
  type EstadoGrabador,
} from "@/components/grabacion/GrabadorSesion";
import { AvisoPrueba } from "@/components/layout/aviso-prueba";
import { Button, Confirmar, Toast } from "@/components/ui";
import { Aparece, Latido } from "@/components/ui/movimiento";
import {
  marcarTurnoRealizado,
  subirAudio,
  volverAGrabando,
} from "@/hooks/useGrabacionSesion";
import { usePantallaEncendida } from "@/hooks/usePantallaEncendida";
import { apiGet, apiPost } from "@/lib/api-client";
import { hora } from "@/lib/format";
import { limpiarGrabacion } from "@/lib/grabacion-storage";
import type { EstadoPrueba } from "@/lib/limites-prueba";
import {
  ALGO_FALLO,
  AUDIO_NO_GUARDADO,
  AVISO_HUECO,
  AVISO_LIMITE_GRABACION,
  AVISO_MICROFONO_SILENCIADO,
  AVISO_PANTALLA_APAGADA,
  AVISO_SIN_AUDIO_DESDE,
  AVISO_SIN_PANTALLA_ENCENDIDA,
  CORTE_LIMITE,
  EN_PAUSA,
  ENTENDIDO,
  ENVIANDO_GRABACION,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABACION_LLEGO,
  GRABACION_TERMINO_MICROFONO,
  GRABAR_SESION,
  GUARDAR_LO_GRABADO,
  PAUSAR,
  PREPARANDO_GRABACION,
  REANUDAR,
  SEGUIR_GRABANDO,
  TERMINAR_SESION,
  TURNO_NO_MARCADO,
  VOLVER_A_LA_FICHA,
} from "@/lib/glosario";

import { MedidorAudio } from "./medidor-audio";

/** Duración por defecto del turno creado al vuelo. */
const DURACION_SIN_TURNO = 50;

/** Estados de la sesión en los que todavía tiene sentido enviar una
 *  grabación que quedó en el teléfono. */
const ADMITE_AUDIO = new Set(["grabando", "subiendo"]);

interface GrabarViewProps {
  /** null cuando la ruta es /grabar/nuevo?pacienteId=… */
  turnoId: string | null;
  /** El turno pasa a "realizado" al confirmar la subida solo si venía así. */
  turnoProgramado: boolean;
  horaTexto: string | null;
  pacienteId: string;
  pacienteNombre: string;
  autorizacionVigente: boolean;
  /** Consultorio creado por invitación: cuántas grabaciones lleva. null en
   *  la cuenta de quien invita. */
  prueba?: EstadoPrueba | null;
}

type Fase =
  | "previo"
  | "preparando"
  | "enviando"
  | "guardado"
  | "no-guardado"
  // El audio ya está en R2 y la nota está en camino; lo único que falló es
  // marcar el turno como realizado. No se vuelve a la ficha hasta resolverlo.
  | "turno-sin-marcar";

type TurnoApi = { id: string; fecha: string };
type SesionApi = { id: string; estado: string };

function mensajeDe(error: unknown, porDefecto: string) {
  return error instanceof Error && error.message ? error.message : porDefecto;
}

export function GrabarView({
  turnoId: turnoIdInicial,
  turnoProgramado,
  horaTexto: horaInicial,
  pacienteId,
  pacienteNombre,
  autorizacionVigente,
  prueba = null,
}: GrabarViewProps) {
  const router = useRouter();

  const [turnoId, setTurnoId] = React.useState(turnoIdInicial);
  const [horaTexto, setHoraTexto] = React.useState(horaInicial);
  const [fase, setFase] = React.useState<Fase>("previo");
  const [progreso, setProgreso] = React.useState<number | null>(null);
  const [errorPantalla, setErrorPantalla] = React.useState<string | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = React.useState(false);
  const [toast, setToast] = React.useState<{ open: boolean; message: string; variante: VarianteToast }>({ open: false, message: "", variante: "aviso" });

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
            setToast({ open: true, message: TURNO_NO_MARCADO, variante: "aviso" });
            setFase("turno-sin-marcar");
            return;
          }
        }

        setFase("guardado");
      } catch (error) {
        // Nada se borra: la grabación sigue en memoria y sus chunks en
        // IndexedDB. La sesión vuelve a "grabando" para repetir desde
        // upload-url con el mismo blob.
        console.warn("[grabar] falló la subida", error);
        setErrorPantalla(AUDIO_NO_GUARDADO);
        setFase("no-guardado");
        await volverAGrabando(sesionId);
      } finally {
        setProgreso(null);
      }
    },
    [],
  );

  const onListo = React.useCallback(
    (datos: DatosGrabacion) => {
      void subir(datos);
    },
    [subir],
  );

  const onErrorGrabacion = React.useCallback((mensaje: string) => {
    setToast({ open: true, message: mensaje, variante: "aviso" });
  }, []);

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
        if (!cancelado && sesion && !ADMITE_AUDIO.has(sesion.estado)) descartarPendiente();
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
      throw new Error("Esta sesión ya está en camino.");
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
    } catch (error) {
      setFase("previo");
      setToast({ open: true, message: mensajeDe(error, ALGO_FALLO), variante: "aviso" });
    }
  }

  /** Una grabación que quedó en este teléfono: se envía tal cual, sin pedir
   *  nada más que la sesión en "grabando". */
  async function enviarPendiente() {
    const turno = turnoIdRef.current;

    if (!turno) {
      setToast({ open: true, message: ALGO_FALLO, variante: "aviso" });
      return;
    }

    setFase("preparando");

    try {
      sesionIdRef.current = await asegurarSesion(turno);
      setFase("previo");
      grabador.enviarPendiente();
    } catch (error) {
      setFase("previo");
      setToast({ open: true, message: mensajeDe(error, ALGO_FALLO), variante: "aviso" });
    }
  }

  function descartar() {
    setConfirmarDescarte(false);
    grabador.descartar();
    router.push(`/pacientes/${pacienteId}`);
  }

  /** Repite solo el PATCH del turno: el audio ya está subido. */
  async function reintentarMarcarRealizado() {
    const turno = turnoIdRef.current;

    if (!turno) {
      setToast({ open: true, message: ALGO_FALLO, variante: "aviso" });
      return;
    }

    try {
      await marcarTurnoRealizado(turno);
      turnoProgramadoRef.current = false;
      setErrorPantalla(null);
      setFase("guardado");
    } catch (error) {
      console.warn("[grabar] el turno no quedó realizado", error);
      setToast({ open: true, message: TURNO_NO_MARCADO, variante: "aviso" });
    }
  }

  function reintentarSubida() {
    const datos = audioRef.current;

    if (!datos) {
      setToast({ open: true, message: ALGO_FALLO, variante: "aviso" });
      return;
    }

    void subir(datos);
  }

  // En el tope de la prueba no se inicia una grabación nueva; el servidor lo
  // rechaza igual (403). Una pendiente sí se puede enviar: ya está contada.
  const sinCupo = prueba?.restantes === 0;
  const volver = () => router.push(`/pacientes/${pacienteId}`);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-80px)] w-full max-w-[560px] flex-col px-5 py-6 lg:py-10">
      {!enCursoAhora && !enviandoAhora && fase !== "guardado" ? (
        <Link
          href={`/pacientes/${pacienteId}`}
          className="mb-6 inline-flex items-center gap-1 self-start text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
        >
          <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>Volver</span>
        </Link>
      ) : null}

      <AvisoPrueba prueba={prueba} className="mb-6" />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <header className="space-y-1">
          <h1 className="font-display text-[28px] leading-tight text-ink-900">
            {pacienteNombre}
          </h1>
          {horaTexto ? (
            <p className="font-mono text-[14px] tabular-nums text-ink-500">
              {horaTexto}
            </p>
          ) : null}
        </header>

        {enviandoAhora ? (
          <PantallaEnviando
            progreso={fase === "enviando" ? (progreso ?? 0) : null}
            pantallaApagada={pantalla.seApago}
            onCerrarAvisoPantalla={pantalla.cerrarAviso}
          />
        ) : fase === "guardado" ? (
          <PantallaLlego onVolver={volver} />
        ) : fase === "no-guardado" ? (
          <PantallaConReintento
            mensaje={errorPantalla ?? AUDIO_NO_GUARDADO}
            onReintentar={reintentarSubida}
          />
        ) : fase === "turno-sin-marcar" ? (
          <PantallaConReintento
            mensaje={errorPantalla ?? TURNO_NO_MARCADO}
            onReintentar={() => void reintentarMarcarRealizado()}
          />
        ) : enCursoAhora ? (
          <PantallaGrabando
            estado={grabador.estado}
            segundos={grabador.segundos}
            nivel={grabador.nivelAudio}
            silencioso={grabador.audioSilencioso}
            microfonoSilenciado={grabador.microfonoSilenciado}
            hueco={grabador.hueco}
            pantallaApagada={pantalla.seApago}
            avisoLimite={grabador.avisoLimite}
            limiteAlcanzado={grabador.limiteAlcanzado}
            conmutando={grabador.conmutando}
            confirmando={confirmarDescarte}
            onPausar={grabador.pausar}
            onReanudar={grabador.reanudar}
            onTerminar={grabador.terminar}
            onCerrarAvisoHueco={grabador.cerrarAvisoHueco}
            onCerrarAvisoPantalla={pantalla.cerrarAviso}
            onPedirDescarte={() => setConfirmarDescarte(true)}
            onCancelarDescarte={() => setConfirmarDescarte(false)}
            onDescartar={descartar}
          />
        ) : grabador.estado === "error" ? (
          <PantallaErrorMicrofono
            mensaje={grabador.mensajeError ?? ALGO_FALLO}
            onReintentar={() => {
              grabador.resetear();
              setFase("previo");
            }}
          />
        ) : (
          <PantallaPrevia
            autorizacionVigente={autorizacionVigente}
            pacienteId={pacienteId}
            preparando={fase === "preparando"}
            sinCupo={sinCupo}
            sinPantallaEncendida={pantalla.estado === "rechazada"}
            pendienteMinutos={
              grabador.pendienteSeg !== null
                ? Math.max(1, Math.round(grabador.pendienteSeg / 60))
                : null
            }
            onEmpezar={() => void empezar()}
            onEnviarPendiente={() => void enviarPendiente()}
            onDescartarPendiente={grabador.descartarPendiente}
          />
        )}
      </div>

      <Toast
        open={toast.open}
        message={toast.message}
        variante={toast.variante}
        onClose={() => setToast((actual) => ({ ...actual, open: false }))}
      />
    </div>
  );
}

function PantallaPrevia({
  autorizacionVigente,
  pacienteId,
  preparando,
  sinCupo,
  sinPantallaEncendida,
  pendienteMinutos,
  onEmpezar,
  onEnviarPendiente,
  onDescartarPendiente,
}: {
  autorizacionVigente: boolean;
  pacienteId: string;
  preparando: boolean;
  /** Tope de grabaciones de la prueba alcanzado: Grabar sesión apagado. */
  sinCupo: boolean;
  /** El teléfono no concedió el wake lock: se dice ANTES de empezar. */
  sinPantallaEncendida: boolean;
  pendienteMinutos: number | null;
  onEmpezar: () => void;
  onEnviarPendiente: () => void;
  onDescartarPendiente: () => void;
}) {
  if (!autorizacionVigente) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="font-display text-[20px] text-ink-900">
          {FALTA_AUTORIZACION}
        </p>
        <Button asChild variant="secondary">
          <Link href={`/pacientes/${pacienteId}`}>{FIRMAR_AUTORIZACION}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {pendienteMinutos !== null ? (
        <div className="w-full rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-4 py-4 text-left">
          <p className="font-sans text-[14px] font-semibold text-ink-900">
            Quedó una grabación de ~{pendienteMinutos} min sin enviar
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={onEnviarPendiente}>
              Guardarla ahora
            </Button>
            <Button variant="secondary" onClick={onDescartarPendiente}>
              Descartarla
            </Button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onEmpezar}
        disabled={preparando || sinCupo}
        className="inline-flex h-[132px] w-[132px] flex-col items-center justify-center gap-2 rounded-full bg-sage-500 text-white shadow-raised transition-colors duration-150 hover:bg-sage-600 active:bg-sage-700 disabled:opacity-60 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30"
      >
        {preparando ? (
          <Loader2
            size={32}
            strokeWidth={1.8}
            aria-hidden="true"
            className="animate-spin"
          />
        ) : (
          <Mic size={32} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span className="font-sans text-[15px] font-semibold leading-tight">
          {GRABAR_SESION}
        </span>
      </button>

      {sinPantallaEncendida ? (
        <div role="status" className="w-full">
          <Aviso icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}>
            {AVISO_SIN_PANTALLA_ENCENDIDA}
          </Aviso>
        </div>
      ) : null}
    </div>
  );
}

function PantallaGrabando({
  estado,
  segundos,
  nivel,
  silencioso,
  microfonoSilenciado,
  hueco,
  pantallaApagada,
  avisoLimite,
  limiteAlcanzado,
  conmutando,
  confirmando,
  onPausar,
  onReanudar,
  onTerminar,
  onCerrarAvisoHueco,
  onCerrarAvisoPantalla,
  onPedirDescarte,
  onCancelarDescarte,
  onDescartar,
}: {
  estado: EstadoGrabador;
  segundos: number;
  nivel: number;
  silencioso: boolean;
  microfonoSilenciado: boolean;
  hueco: AvisoHueco | null;
  pantallaApagada: boolean;
  avisoLimite: boolean;
  limiteAlcanzado: boolean;
  conmutando: boolean;
  confirmando: boolean;
  onPausar: () => void;
  onReanudar: () => void;
  onTerminar: () => void;
  onCerrarAvisoHueco: () => void;
  onCerrarAvisoPantalla: () => void;
  onPedirDescarte: () => void;
  onCancelarDescarte: () => void;
  onDescartar: () => void;
}) {
  // El micrófono se fue: la grabación terminó y sólo queda guardarla.
  const terminada = estado === "terminada";

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {/* El punto respira solo mientras entra audio. En pausa se queda
          quieto y atenuado: que deje de moverse ES la confirmación de que
          la grabación está detenida, sin tener que leer la palabra. */}
      <div className="flex items-center gap-2">
        {estado === "grabando" ? (
          <Latido tamano={10} className="bg-[color:var(--color-error)]" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-[10px] w-[10px] shrink-0 rounded-full bg-[color:var(--color-error)] opacity-40"
          />
        )}
        <Aparece
          como="span"
          key={estado}
          className="font-sans text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500"
        >
          {estado === "grabando" ? "REC" : terminada ? "Terminada" : EN_PAUSA}
        </Aparece>
      </div>

      <p
        className="font-mono text-[52px] font-semibold leading-none tabular-nums text-ink-900"
        aria-label={`${Math.floor(segundos)} segundos grabados`}
      >
        {formatearDuracion(segundos)}
      </p>

      {terminada ? (
        <div role="alert" className="flex flex-col items-center gap-2">
          <MicOff
            size={20}
            strokeWidth={1.9}
            aria-hidden="true"
            className="text-[color:var(--color-error)]"
          />
          <p className="max-w-[340px] font-sans text-[14px] leading-[1.5] text-ink-700">
            {GRABACION_TERMINO_MICROFONO}
          </p>
        </div>
      ) : (
        <>
          <MedidorAudio nivel={nivel} silencioso={silencioso} />
          <div role="status" className="flex w-full flex-col gap-2 empty:hidden">
            {pantallaApagada ? (
              <Aviso
                icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}
                accion={ENTENDIDO}
                onAccion={onCerrarAvisoPantalla}
              >
                {AVISO_PANTALLA_APAGADA}
              </Aviso>
            ) : null}
            {hueco ? (
              hueco.hasta === null ? (
                <Aviso icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}>
                  {AVISO_SIN_AUDIO_DESDE(hueco.desde)}
                </Aviso>
              ) : (
                <Aviso
                  icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}
                  accion={SEGUIR_GRABANDO}
                  onAccion={onCerrarAvisoHueco}
                >
                  {AVISO_HUECO(hueco.desde, hueco.hasta)}
                </Aviso>
              )
            ) : null}
            {microfonoSilenciado ? (
              <Aviso icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}>
                {AVISO_MICROFONO_SILENCIADO}
              </Aviso>
            ) : null}
            {limiteAlcanzado ? (
              <Aviso icono={<Square size={13} strokeWidth={2} aria-hidden="true" />}>
                {CORTE_LIMITE}
              </Aviso>
            ) : avisoLimite ? (
              <Aviso icono={<Square size={13} strokeWidth={2} aria-hidden="true" />}>
                {AVISO_LIMITE_GRABACION}
              </Aviso>
            ) : null}
          </div>
        </>
      )}

      {confirmando ? (
        <Confirmar
          className="w-full text-left"
          titulo="¿Descartar la grabación?"
          mensaje="Se borra el audio de este teléfono. No se puede recuperar."
          accion="Descartar"
          variante="peligro"
          onConfirmar={onDescartar}
          onCancelar={onCancelarDescarte}
        />
      ) : (
        <>
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            {terminada || limiteAlcanzado ? null : estado === "pausado" ? (
              <Button
                className="flex-1"
                onClick={onReanudar}
                disabled={conmutando}
                icon={<Play size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {REANUDAR}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onPausar}
                disabled={conmutando}
                icon={<Pause size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {PAUSAR}
              </Button>
            )}

            <Button
              className="flex-1 border-transparent !bg-[color:var(--color-error)] text-white hover:!bg-[#8f3b3b] active:!bg-[#7c3232]"
              onClick={onTerminar}
              icon={<Square size={15} strokeWidth={2} aria-hidden="true" />}
            >
              {terminada ? GUARDAR_LO_GRABADO : TERMINAR_SESION}
            </Button>
          </div>

          <button
            type="button"
            onClick={onPedirDescarte}
            className="font-sans text-[13px] text-ink-500 underline underline-offset-4 transition-colors duration-150 hover:text-terracotta-600"
          >
            Descartar grabación
          </button>
        </>
      )}

      {/* El 7/9 y el 18/9 el teléfono se bloqueó a mitad de sesión y dejó de
          entregar audio sin avisar. La app pide mantener la pantalla
          encendida, pero el teléfono puede no hacer caso: se le dice a ella. */}
      <p className="max-w-[320px] font-sans text-[13px] leading-[1.55] text-ink-500">
        Dejá la pantalla encendida mientras grabás.
      </p>
    </div>
  );
}

/** Un aviso persistente. Con `accion`, queda hasta que ella lo cierra. */
function Aviso({
  icono,
  children,
  accion,
  onAccion,
}: {
  icono: React.ReactNode;
  children: React.ReactNode;
  accion?: string;
  onAccion?: () => void;
}) {
  return (
    <div className="flex w-full items-start gap-2 rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-3 py-2 text-left">
      <span className="mt-[2px] shrink-0 text-ink-500">{icono}</span>
      <div className="flex flex-col items-start gap-1">
        <p className="font-sans text-[13px] leading-[1.45] text-ink-700">
          {children}
        </p>
        {accion && onAccion ? (
          <button
            type="button"
            onClick={onAccion}
            className="min-h-8 font-sans text-[13px] font-semibold text-sage-700 underline underline-offset-4"
          >
            {accion}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Después de Terminar. Tapa toda la pantalla, menú inferior incluido: mientras
// la grabación viaja no hay adónde ir, y tocar el menú sin querer la cortaba.
// Siempre hay algo que se mueve: una pantalla quieta se lee como "se colgó".
function PantallaEnviando({
  progreso,
  pantallaApagada,
  onCerrarAvisoPantalla,
}: {
  /** null mientras se prepara el archivo; 0-100 mientras viaja. */
  progreso: number | null;
  pantallaApagada: boolean;
  onCerrarAvisoPantalla: () => void;
}) {
  const texto = progreso === null ? PREPARANDO_GRABACION : ENVIANDO_GRABACION(progreso);

  return (
    <div
      data-testid="enviando"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-cream-50 px-6 text-center"
    >
      <Loader2 size={34} strokeWidth={1.8} aria-hidden="true" className="animate-spin text-sage-500" />
      <p role="status" aria-live="polite" className="max-w-[320px] font-sans text-[16px] font-semibold leading-[1.45] text-ink-900">
        {texto}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progreso ?? undefined}
        aria-label={texto}
        className="h-[6px] w-full max-w-[280px] overflow-hidden rounded-full bg-cream-200"
      >
        <div
          className="h-full rounded-full bg-sage-500 transition-[width] duration-200"
          style={{ width: `${Math.max(progreso ?? 0, 4)}%` }}
        />
      </div>
      {pantallaApagada ? (
        <div className="w-full max-w-[340px]">
          <Aviso
            icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}
            accion={ENTENDIDO}
            onAccion={onCerrarAvisoPantalla}
          >
            {AVISO_PANTALLA_APAGADA}
          </Aviso>
        </div>
      ) : null}
    </div>
  );
}

// La grabación llegó. La pantalla se queda acá hasta que ella decida irse.
function PantallaLlego({ onVolver }: { onVolver: () => void }) {
  return (
    <Aparece className="flex w-full flex-col items-center gap-5">
      <Check size={30} strokeWidth={2} aria-hidden="true" className="text-sage-600" />
      <p role="status" className="max-w-[340px] font-sans text-[16px] font-semibold leading-[1.5] text-ink-900">
        {GRABACION_LLEGO}
      </p>
      <Button className="w-full sm:w-auto" onClick={onVolver}>
        {VOLVER_A_LA_FICHA}
      </Button>
    </Aparece>
  );
}

// Un mensaje y un botón para volver a intentar. Lo usan los dos fallos que
// no pierden nada: la subida del audio y el turno que no quedó realizado.
function PantallaConReintento({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <p className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
        {mensaje}
      </p>
      <Button className="w-full sm:w-auto" onClick={onReintentar}>
        Reintentar
      </Button>
    </div>
  );
}

function PantallaErrorMicrofono({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <MicOff
        size={24}
        strokeWidth={1.9}
        aria-hidden="true"
        className="text-[color:var(--color-error)]"
      />
      <p className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
        {mensaje}
      </p>
      <Button variant="secondary" onClick={onReintentar}>
        Probá de nuevo
      </Button>
    </div>
  );
}

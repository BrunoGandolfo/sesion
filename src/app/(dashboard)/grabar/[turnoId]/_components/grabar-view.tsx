"use client";

// Capa visual de la grabación. Toda la lógica (chunks, pausa, cifrado,
// IndexedDB, recuperación) vive en useGrabador; acá está el orden de la
// pantalla y la conversación con la API:
//
//   crear turno (solo si no había)  →  asegurar la sesión clínica en
//   "grabando"  →  grabar  →  cifrar  →  upload-url / PUT a R2 /
//   upload-confirmar  →  el turno pasa a realizado  →  volver a la ficha.
//
// No hay pantalla intermedia entre "Terminar la sesión" y la subida: cuando
// la terapeuta termina, termina.

import * as React from "react";
import type { VarianteToast } from "@/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
  type DatosGrabacion,
  type EstadoGrabador,
  type MotivoInterrupcion,
} from "@/components/grabacion/GrabadorSesion";
import { Button, Confirmar, Toast } from "@/components/ui";
import { AnilloProgreso, Aparece, Latido } from "@/components/ui/movimiento";
import {
  marcarTurnoRealizado,
  subirAudioCifrado,
  volverAGrabando,
} from "@/hooks/useGrabacionSesion";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { hora } from "@/lib/format";
import { limpiarGrabacion } from "@/lib/grabacion-storage";
import {
  ALGO_FALLO,
  AUDIO_NO_GUARDADO,
  AVISO_LIMITE_GRABACION,
  AVISO_PANTALLA_APAGADA,
  CORTE_LIMITE,
  CORTE_MICROFONO,
  CORTE_PANTALLA,
  CORTE_SIN_SONIDO,
  EN_PAUSA,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABAR_SESION,
  GUARDANDO,
  PAUSAR,
  REANUDAR,
  TERMINAR_SESION,
  TURNO_NO_MARCADO,
} from "@/lib/glosario";

import { MedidorAudio } from "./medidor-audio";

const NOTA_EN_CAMINO = "Te avisamos cuando la nota esté lista";

/** Duración por defecto del turno creado al vuelo. */
const DURACION_SIN_TURNO = 50;

// Cuánto queda el toast en pantalla antes de volver a la ficha.
const MS_ANTES_DE_VOLVER = 1600;

interface GrabarViewProps {
  /** null cuando la ruta es /grabar/nuevo?pacienteId=… */
  turnoId: string | null;
  /** El turno pasa a "realizado" al confirmar la subida solo si venía así. */
  turnoProgramado: boolean;
  horaTexto: string | null;
  pacienteId: string;
  pacienteNombre: string;
  autorizacionVigente: boolean;
}

type Fase =
  | "previo"
  | "preparando"
  | "guardando"
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
}: GrabarViewProps) {
  const router = useRouter();

  const [turnoId, setTurnoId] = React.useState(turnoIdInicial);
  const [horaTexto, setHoraTexto] = React.useState(horaInicial);
  const [fase, setFase] = React.useState<Fase>("previo");
  const [progreso, setProgreso] = React.useState<number | null>(null);
  const [errorPantalla, setErrorPantalla] = React.useState<string | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = React.useState(false);
  const [toast, setToast] = React.useState<{ open: boolean; message: string; variante: VarianteToast }>({ open: false, message: "", variante: "aviso" });

  // El audio cifrado del último intento: lo que hace posible "Reintentar" sin
  // volver a grabar. Los chunks sin cifrar siguen en IndexedDB hasta que la
  // confirmación responde OK.
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
      setFase("guardando");

      try {
        await subirAudioCifrado(sesionId, datos, (p) => setProgreso(p));

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
        setToast({ open: true, message: NOTA_EN_CAMINO, variante: "confirmacion" });
      } catch (error) {
        // Nada se borra: el blob cifrado queda en memoria y los chunks en
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

  // Vuelta a la ficha una vez que el toast se leyó. Timeout, no setState:
  // el efecto solo agenda la navegación.
  React.useEffect(() => {
    if (fase !== "guardado") return;

    const timer = window.setTimeout(() => {
      router.push(`/pacientes/${pacienteId}`);
    }, MS_ANTES_DE_VOLVER);

    return () => window.clearTimeout(timer);
  }, [fase, pacienteId, router]);

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

    if (sesion.estado === "pendiente") {
      sesion = await apiPatch<SesionApi>(`/api/sesion-clinica/${sesion.id}`, {
        estado: "grabando",
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
        });

        turno = creado.id;
        turnoIdRef.current = turno;
        turnoProgramadoRef.current = true;
        setTurnoId(turno);
        setHoraTexto(hora(new Date(creado.fecha)));
      }

      sesionIdRef.current = await asegurarSesion(turno);
      await grabador.iniciar(turno);
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
      setToast({ open: true, message: NOTA_EN_CAMINO, variante: "confirmacion" });
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

  const grabando = grabador.estado === "grabando";
  const pausado = grabador.estado === "pausado";
  const interrumpida = grabador.estado === "interrumpida";
  const enCurso = grabando || pausado || interrumpida;

  const mostrandoSubida = fase === "guardando" || fase === "guardado";
  const cifrando = grabador.estado === "cifrando";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-80px)] w-full max-w-[560px] flex-col px-5 py-6 lg:py-10">
      {!enCurso && !mostrandoSubida && !cifrando ? (
        <Link
          href={`/pacientes/${pacienteId}`}
          className="mb-6 inline-flex items-center gap-1 self-start text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
        >
          <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>Volver</span>
        </Link>
      ) : null}

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

        {mostrandoSubida || cifrando ? (
          <PantallaGuardando
            progreso={fase === "guardado" ? 100 : progreso}
          />
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
        ) : enCurso ? (
          <PantallaGrabando
            estado={grabador.estado}
            segundos={grabador.segundos}
            nivel={grabador.nivelAudio}
            silencioso={grabador.audioSilencioso}
            pantallaApagada={grabador.wakeLockSoltado}
            avisoLimite={grabador.avisoLimite}
            motivoInterrupcion={grabador.motivoInterrupcion}
            mensajeError={grabador.mensajeError}
            confirmando={confirmarDescarte}
            onPausar={grabador.pausar}
            onReanudar={grabador.reanudar}
            onReanudarTrasCorte={() => void grabador.reanudarTrasInterrupcion()}
            onTerminar={grabador.terminar}
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
            pendienteMinutos={
              grabador.pendiente
                ? Math.max(1, Math.round(grabador.pendiente.duracionAproxSeg / 60))
                : null
            }
            onEmpezar={() => void empezar()}
            onEnviarPendiente={grabador.enviarPendiente}
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
  pendienteMinutos,
  onEmpezar,
  onEnviarPendiente,
  onDescartarPendiente,
}: {
  autorizacionVigente: boolean;
  pacienteId: string;
  preparando: boolean;
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
        disabled={preparando}
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
    </div>
  );
}

function PantallaGrabando({
  estado,
  segundos,
  nivel,
  silencioso,
  pantallaApagada,
  avisoLimite,
  motivoInterrupcion,
  mensajeError,
  confirmando,
  onPausar,
  onReanudar,
  onReanudarTrasCorte,
  onTerminar,
  onPedirDescarte,
  onCancelarDescarte,
  onDescartar,
}: {
  estado: EstadoGrabador;
  segundos: number;
  nivel: number;
  silencioso: boolean;
  pantallaApagada: boolean;
  avisoLimite: boolean;
  motivoInterrupcion: MotivoInterrupcion | null;
  mensajeError: string | null;
  confirmando: boolean;
  onPausar: () => void;
  onReanudar: () => void;
  onReanudarTrasCorte: () => void;
  onTerminar: () => void;
  onPedirDescarte: () => void;
  onCancelarDescarte: () => void;
  onDescartar: () => void;
}) {
  const interrumpida = estado === "interrumpida";

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
          {estado === "grabando" ? "REC" : interrumpida ? "Cortado" : EN_PAUSA}
        </Aparece>
      </div>

      <p
        className="font-mono text-[52px] font-semibold leading-none tabular-nums text-ink-900"
        aria-label={`${segundos} segundos grabados`}
      >
        {formatearDuracion(segundos)}
      </p>

      {interrumpida ? (
        <div className="flex flex-col items-center gap-2">
          <MicOff
            size={20}
            strokeWidth={1.9}
            aria-hidden="true"
            className="text-[color:var(--color-error)]"
          />
          {/* Cuatro cortes distintos, cuatro explicaciones distintas: volver
              a pedir el micrófono no arregla haber llegado al tope, y decirle
              "se cortó el micrófono" cuando lo que pasó fue que se apagó la
              pantalla la manda a buscar el problema donde no está. */}
          <p className="font-sans text-[14px] text-ink-700">
            {textoDelCorte(motivoInterrupcion)}
          </p>
          {mensajeError ? (
            <p className="font-sans text-[13px] text-[color:var(--color-error)]">
              {mensajeError}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <MedidorAudio nivel={nivel} silencioso={silencioso} />
          <AvisosDeGrabacion
            pantallaApagada={pantallaApagada}
            avisoLimite={avisoLimite}
          />
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
            {interrumpida ? (
              <Button
                className="flex-1"
                onClick={onReanudarTrasCorte}
                icon={<Play size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {REANUDAR}
              </Button>
            ) : estado === "pausado" ? (
              <Button
                className="flex-1"
                onClick={onReanudar}
                icon={<Play size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {REANUDAR}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onPausar}
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
              {TERMINAR_SESION}
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

      {/* Decía "Podés bloquear la pantalla". Podías, y por eso el 7/9 una
          sesión de 120 minutos llegó cortada en 90: con la pantalla apagada
          el micrófono deja de entregar señal sin avisar. Ahora la grabación
          se pausa sola en vez de subirse, pero seguir grabando con la
          pantalla encendida sigue siendo lo que mejor funciona. */}
      <p className="max-w-[320px] font-sans text-[13px] leading-[1.55] text-ink-500">
        Se guarda cifrado en el teléfono. Dejá la pantalla encendida.
      </p>
    </div>
  );
}

/**
 * Por qué se interrumpió la grabación, en las palabras del glosario.
 *
 * El fallback es el corte de micrófono porque es el único que existía antes
 * de que la interrupción tuviera motivo: una grabación cortada por una
 * versión anterior no tiene con qué contestar, y "se cortó el micrófono" es
 * lo que decía entonces.
 */
function textoDelCorte(motivo: MotivoInterrupcion | null) {
  switch (motivo) {
    case "limite":
      return CORTE_LIMITE;
    case "sin-sonido":
      return CORTE_SIN_SONIDO;
    case "pantalla":
      return CORTE_PANTALLA;
    default:
      return CORTE_MICROFONO;
  }
}

/**
 * Los avisos de una grabación en curso: persistentes, apilados, y ninguno
 * interrumpe nada.
 *
 * Los dos son cosas que el grabador ya sabía desde siempre y que nadie leía:
 * `wakeLockSoltado` y `avisoLimite` se calculaban y se tiraban. Se muestran
 * mientras la condición dure y se van solos cuando se resuelve: no hay nada
 * que cerrar ni que confirmar, porque el trabajo de ella es la sesión, no la
 * app.
 *
 * El tercer aviso —el silencio— vive en el medidor, pegado a las barras en
 * cero que lo explican.
 *
 * El orden es el de urgencia: la pantalla apagada primero, porque es la única
 * que puede terminar en una grabación pausada a mitad de sesión.
 */
function AvisosDeGrabacion({
  pantallaApagada,
  avisoLimite,
}: {
  pantallaApagada: boolean;
  avisoLimite: boolean;
}) {
  if (!pantallaApagada && !avisoLimite) {
    return null;
  }

  return (
    <div role="status" className="flex w-full flex-col gap-2">
      {pantallaApagada ? (
        <Aviso icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}>
          {AVISO_PANTALLA_APAGADA}
        </Aviso>
      ) : null}
      {avisoLimite ? (
        <Aviso icono={<Square size={13} strokeWidth={2} aria-hidden="true" />}>
          {AVISO_LIMITE_GRABACION}
        </Aviso>
      ) : null}
    </div>
  );
}

function Aviso({
  icono,
  children,
}: {
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-start gap-2 rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-3 py-2 text-left">
      <span className="mt-[2px] shrink-0 text-ink-500">{icono}</span>
      <p className="font-sans text-[13px] leading-[1.45] text-ink-700">
        {children}
      </p>
    </div>
  );
}

// Entra con un fundido corto en el mismo lugar donde estaba el cronómetro:
// "Terminar la sesión" no cambia de pantalla, cambia de estado. El salto
// que había antes hacía dudar de si se había apretado bien.
function PantallaGuardando({ progreso }: { progreso: number | null }) {
  return (
    <Aparece className="flex w-full flex-col items-center gap-5">
      <AnilloProgreso tamano={30} className="text-sage-500" etiqueta={GUARDANDO} />
      <p className="font-sans text-[16px] font-semibold text-ink-900">
        {GUARDANDO}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progreso ?? undefined}
        aria-label={GUARDANDO}
        className="h-[6px] w-full max-w-[280px] overflow-hidden rounded-full bg-cream-200"
      >
        <div
          className="h-full rounded-full bg-sage-500 transition-[width] duration-200"
          style={{ width: `${progreso ?? 6}%` }}
        />
      </div>
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

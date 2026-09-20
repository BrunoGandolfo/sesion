"use client";

// Pestaña Sesiones: la lista de sesiones, y nada antes que ella.
//
// Una investigación de uso sobre producción encontró la lista enterrada: con
// dos sesiones, su título aparecía a 2060 px del comienzo en el celular,
// debajo de una tarjeta "Hoy" y de un resumen largo y abierto. Y la sesión de
// hoy se sacaba de la lista, así que el contador decía "2 sesiones" y se veía
// una. Ahora:
//
//   - el título de la lista es lo primero de la pestaña;
//   - cada sesión aparece UNA vez, la de hoy incluida, destacada en su lugar
//     —arriba, porque es la más reciente— con su acción pendiente adentro;
//   - el contador cuenta lo que la lista muestra;
//   - el resumen previo es el botón "Preparar sesión" del renglón del título
//     (brief-pre-sesion.tsx), cerrado salvo que la ficha venga con ?preparar=1;
//   - el resumen de cada fila va entero: ningún texto clínico se recorta.
//
// Acá no se graba ni se revisa nada: grabar vive en /grabar/[turnoId] y la
// nota en /sesiones/[id]. La sesión de hoy llega por props (polling del
// hook de grabación en el padre).

import * as React from "react";
import type { VarianteToast } from "@/components/ui/toast";
import Link from "next/link";
import { ChevronDown, ChevronRight, Mic } from "lucide-react";
import { fechaInputMvd, formatearMesMvd } from "@/lib/fechas-montevideo";

import { Button, Card, Chip } from "@/components/ui";
import { IndicadorProcesando } from "@/components/ui/procesando";
import { enProceso } from "@/lib/notas-en-proceso";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { hayParaVos } from "@/components/grabacion/FeedbackTerapeutaView";
import { esDeudaPendiente } from "@/app/api/_lib/domain";
import { apiGet, esAbort } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaLarga, hora } from "@/lib/format";
import {
  ALGO_FALLO,
  ESCRIBIENDO_NOTA,
  GRABAR_SESION,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  PARA_REVISAR,
  PARA_VOS,
  REVISAR_NOTA,
  SESION_DE_HOY,
  VER_NOTA,
  pluralizar,
} from "@/lib/glosario";
import type {
  DatosEstructurados,
  EstadoSesion,
  NotaSoap,
} from "@/lib/sesion-clinica/schema";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import type { EstadoProcesamiento, Modalidad, Turno } from "@/types/domain";

import { BriefPreSesion } from "./brief-pre-sesion";
import { CobrarSheet } from "./turnos-pagos-tab";

interface SesionesTabProps {
  pacienteId: string;
  /** Nombre y apellido: lo dice el indicador mientras se escribe la nota. */
  pacienteNombre: string;
  turnoHoy: Turno | null;
  sesionHoy: SesionClinicaEnsamblada | null;
  sesionHoyCargando: boolean;
  onTurnoActualizado: () => void;
  onAviso: (mensaje: string, variante?: VarianteToast) => void;
  /** La ficha se pidió con ?preparar=1: "Preparar sesión" arranca abierto. */
  prepararAbierto?: boolean;
  /** Se vuelve de la nota de esta sesión: su mes se abre y la fila se trae a
   *  la vista. */
  volverA?: string | null;
  /** La fila ya se buscó (estuviera o no): el padre borra ?vuelve de la URL. */
  onVolvio?: () => void;
  /** Se tocó un enlace a la nota de esta sesión: el padre lo anota en la URL
   *  para que "volver" sepa a dónde. */
  onAbrirSesion?: (sesionClinicaId: string) => void;
}

// Ítem de GET /api/pacientes/[id]/documentacion: la nota vigente (aprobada
// o de la IA) y el tablero parseado en el servidor; el feedback tal cual.
type DocSesion = {
  sesionClinicaId: string;
  turnoId: string;
  fecha: string;
  duracionMin: number;
  duracionAudioSeg: number | null;
  modalidad: Modalidad;
  estado: Extract<EstadoSesion, "revision" | "aprobada">;
  nota: NotaSoap | null;
  datos: DatosEstructurados | null;
  feedback: unknown;
  aprobadaEn: string | null;
  procesadaEn: string | null;
};

type DocResponse = {
  pacienteId: string;
  totalSesiones: number;
  sesiones: DocSesion[];
  page: number;
  totalPages: number;
};

const PAGE_SIZE = 10;

// Lista atada al paciente que la cargó: al cambiar el id, la anterior deja
// de aplicar por derivación, sin resetear estado dentro de un efecto.
type ListaState = {
  pacienteId: string;
  docs: DocSesion[];
  totalPages: number;
  totalSesiones: number;
  page: number;
  loading: boolean;
  error: string | null;
};

function listaInicial(pacienteId: string): ListaState {
  return {
    pacienteId,
    docs: [],
    totalPages: 0,
    totalSesiones: 0,
    page: 1,
    loading: true,
    error: null,
  };
}

function urlDocumentacion(pacienteId: string, page: number): string {
  return `/api/pacientes/${pacienteId}/documentacion?page=${page}&limit=${PAGE_SIZE}`;
}

function chipDeEstado(estado: EstadoProcesamiento): {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
} | null {
  switch (estado) {
    case "grabando":
      return { variant: "terracotta", label: "Grabando…" };
    case "subiendo":
    case "procesando":
      return { variant: "gold", label: ESCRIBIENDO_NOTA };
    case "revision":
      return { variant: "gold", label: PARA_REVISAR };
    case "aprobada":
      return { variant: "sage", label: NOTA_GUARDADA };
    case "fallida":
      return { variant: "terracotta", label: NOTA_NO_ESCRITA };
    default:
      return null;
  }
}

function resumenCorto(datos: DatosEstructurados | null): string {
  return datos?.resumenSesion?.trim() ?? "";
}

/** Segunda línea de la fila cuando la nota no dejó resumen: los temas, con
 *  su nombre legible. Es lo que hay; no se rellena con texto inventado. */
function temasDeLaSesion(datos: DatosEstructurados | null): string {
  const temas = datos?.temas ?? [];
  if (temas.length === 0) return "";
  return temas.map(formatearEtiqueta).filter(Boolean).join(" · ");
}

// ────────────────────────────────────────────────────────────────────────────
// Agrupación por mes
//
// Con 40 sesiones la lista plana es un scroll sin referencias: cada fila dice
// "lunes 4 de marzo" y no hay forma de saltar a un período. Agrupada por mes,
// el mes corriente queda abierto y los anteriores plegados, con su cuenta a
// la vista.
// ────────────────────────────────────────────────────────────────────────────

/** Lo que la lista muestra: una sesión con nota (viene de /documentacion) o
 *  el turno de hoy cuya sesión todavía no tiene nota —sin grabar, en proceso
 *  o fallida—, que /documentacion no trae. */
type Fila =
  | { tipo: "nota"; clave: string; fecha: Date; doc: DocSesion }
  | { tipo: "hoy"; clave: string; fecha: Date; turno: Turno };

type GrupoMes = { clave: string; titulo: string; filas: Fila[] };

function tituloDeMes(fecha: Date): string {
  const texto = formatearMesMvd(fecha, true);
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

/** Agrupa por mes conservando el orden en que vino la lista (la API la manda
 *  de la más reciente a la más vieja). */
function agruparPorMes(filas: Fila[]): GrupoMes[] {
  const grupos: GrupoMes[] = [];
  for (const fila of filas) {
    const clave = fechaInputMvd(fila.fecha).slice(0, 7);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) {
      ultimo.filas.push(fila);
      continue;
    }
    grupos.push({ clave, titulo: tituloDeMes(fila.fecha), filas: [fila] });
  }
  return grupos;
}

const ENLACE_PRIMARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-sage-500 px-5 font-sans text-[14px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:bg-sage-600 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30";
const ENLACE_SECUNDARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-white px-5 font-sans text-[14px] font-semibold text-ink-900 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20";

export function SesionesTab({
  pacienteId,
  pacienteNombre,
  turnoHoy,
  sesionHoy,
  sesionHoyCargando,
  onTurnoActualizado,
  onAviso,
  prepararAbierto = false,
  volverA = null,
  onVolvio,
  onAbrirSesion,
}: SesionesTabProps) {
  const [lista, setLista] = React.useState<ListaState>(() => listaInicial(pacienteId));
  const [reloadKey, setReloadKey] = React.useState(0);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);

  const listaActual =
    lista.pacienteId === pacienteId ? lista : listaInicial(pacienteId);
  const notaDeHoy =
    sesionHoy && (sesionHoy.estado === "revision" || sesionHoy.estado === "aprobada")
      ? sesionHoy.estado
      : null;

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<DocResponse>(urlDocumentacion(pacienteId, 1), {
      signal: controller.signal,
    })
      .then((data) =>
        setLista({
          pacienteId,
          docs: data.sesiones,
          totalPages: data.totalPages,
          totalSesiones: data.totalSesiones,
          page: 1,
          loading: false,
          error: null,
        }),
      )
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        setLista({
          ...listaInicial(pacienteId),
          loading: false,
          error: err instanceof Error ? err.message : ALGO_FALLO,
        });
      });
    return () => controller.abort();
    // `notaDeHoy`: cuando la sesión de hoy pasa a tener nota (el polling del
    // padre la ve llegar a "revision"), la lista se vuelve a pedir para que la
    // traiga con su resumen.
  }, [pacienteId, reloadKey, notaDeHoy]);

  // La sesión de hoy va UNA vez. Si ya tiene nota, /documentacion la trae y se
  // destaca en su fila. Si no, se agrega acá, primera: es la más reciente.
  const hoyEnLaLista =
    turnoHoy !== null && listaActual.docs.some((d) => d.turnoId === turnoHoy.id);
  const hoySuelta = turnoHoy !== null && !listaActual.loading && !hoyEnLaLista;

  const grupos = React.useMemo(() => {
    const filas: Fila[] = listaActual.docs.map((doc) => ({
      tipo: "nota",
      clave: doc.sesionClinicaId,
      fecha: new Date(doc.fecha),
      doc,
    }));
    if (hoySuelta && turnoHoy) {
      filas.unshift({ tipo: "hoy", clave: turnoHoy.id, fecha: turnoHoy.fecha, turno: turnoHoy });
    }
    return agruparPorMes(filas);
  }, [listaActual.docs, hoySuelta, turnoHoy]);

  // El contador cuenta lo que la lista muestra.
  const totalEnLista = listaActual.totalSesiones + (hoySuelta ? 1 : 0);

  // Volver de una nota: la fila de esa sesión, a la vista. Una sola vez, y
  // sólo con lo que la URL traía AL MONTAR: al tocar una sesión el padre
  // escribe ?vuelve en la entrada que se está dejando, y eso no es una vuelta.
  const [vuelveA] = React.useState(volverA);
  const yaVolvio = React.useRef(false);
  React.useEffect(() => {
    if (!vuelveA || yaVolvio.current || listaActual.loading) return;
    yaVolvio.current = true;
    document.getElementById(`sesion-${vuelveA}`)?.scrollIntoView?.({ block: "center" });
    onVolvio?.();
  }, [vuelveA, listaActual.loading, onVolvio]);

  function alTocarLaLista(evento: React.MouseEvent<HTMLElement>) {
    const enlace = (evento.target as HTMLElement).closest('a[href^="/sesiones/"]');
    const fila = enlace?.closest<HTMLElement>("[data-sesion-id]");
    if (fila?.dataset.sesionId) onAbrirSesion?.(fila.dataset.sesionId);
  }

  async function cargarMas() {
    const next = listaActual.page + 1;
    if (next > listaActual.totalPages) return;
    setLista((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiGet<DocResponse>(urlDocumentacion(pacienteId, next));
      setLista((prev) => ({
        ...prev,
        docs: [...prev.docs, ...data.sesiones],
        page: next,
        totalPages: data.totalPages,
        totalSesiones: data.totalSesiones,
        loading: false,
      }));
    } catch (err) {
      setLista((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : ALGO_FALLO,
      }));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" onClickCapture={alTocarLaLista}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[20px] font-medium tracking-[-0.01em] text-ink-900">
              Sesiones
            </h2>
            {totalEnLista > 0 ? (
              <span className="font-sans text-[12px] text-ink-500">
                {pluralizar(totalEnLista, "sesión", "sesiones")}
              </span>
            ) : null}
          </div>
          <BriefPreSesion pacienteId={pacienteId} abrir={prepararAbierto} />
        </div>

        {listaActual.error ? (
          <div className="flex items-center gap-3">
            <p className="font-sans text-[13px] text-[color:var(--color-error)]">
              {listaActual.error}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Reintentar
            </Button>
          </div>
        ) : null}

        {listaActual.loading && listaActual.docs.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-500">Cargando…</p>
        ) : null}

        {!listaActual.loading && grupos.length === 0 && !listaActual.error ? (
          <Card className="border-[color:var(--border-subtle)]">
            <p className="font-sans text-[14px] leading-[1.6] text-ink-500">
              Todavía no hay sesiones grabadas. Cuando grabes la primera, la
              nota va a aparecer acá.
            </p>
          </Card>
        ) : null}

        {grupos.length > 0 ? (
          <div className="flex flex-col gap-4">
            {grupos.map((grupo, indice) => (
              <GrupoDeMes
                key={grupo.clave}
                grupo={grupo}
                abiertoPorDefecto={
                  indice === 0 || grupo.filas.some((f) => f.clave === vuelveA)
                }
                hoy={{
                  turno: turnoHoy,
                  sesion: sesionHoy,
                  cargando: sesionHoyCargando,
                  paciente: pacienteNombre,
                  onCobrar: () => setCobroTarget(turnoHoy),
                }}
              />
            ))}
          </div>
        ) : null}

        {listaActual.page < listaActual.totalPages ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              onClick={() => void cargarMas()}
              disabled={listaActual.loading}
            >
              {listaActual.loading ? "Cargando…" : "Cargar más"}
            </Button>
          </div>
        ) : null}
      </section>

      <CobrarSheet
        turno={cobroTarget}
        onClose={() => setCobroTarget(null)}
        onCobrado={() => {
          onAviso("Cobrado", "confirmacion");
          onTurnoActualizado();
        }}
        onError={onAviso}
      />
    </div>
  );
}

/** Lo que las filas necesitan saber de la sesión de hoy. */
type Hoy = {
  turno: Turno | null;
  sesion: SesionClinicaEnsamblada | null;
  cargando: boolean;
  paciente: string;
  onCobrar: () => void;
};

const FILA =
  "relative flex flex-col gap-2 rounded-lg border px-4 py-4 transition-colors duration-[var(--duration-fast)] focus-within:ring-[3px] focus-within:ring-sage-500/20 sm:px-5";
const FILA_COMUN = `${FILA} border-[color:var(--border-subtle)] bg-white hover:bg-cream-50`;
const FILA_DE_HOY = `${FILA} border-sage-200 bg-sage-50`;

function MarcaDeHoy() {
  return (
    <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-sage-700">
      {SESION_DE_HOY}
    </span>
  );
}

function modalidadTexto(modalidad: Modalidad): string {
  return modalidad === "online" ? "Online" : "Presencial";
}

/** Un mes de la lista. El más reciente arranca abierto; los anteriores,
 *  plegados, con la cuenta del mes a la vista para no tener que abrirlos. */
function GrupoDeMes({
  grupo,
  abiertoPorDefecto,
  hoy,
}: {
  grupo: GrupoMes;
  abiertoPorDefecto: boolean;
  hoy: Hoy;
}) {
  const [abierto, setAbierto] = React.useState(abiertoPorDefecto);
  const panelId = React.useId();

  return (
    <section>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((previo) => !previo)}
        className="flex min-h-[44px] w-full items-baseline justify-between gap-3 border-b border-[color:var(--border-subtle)] pb-2 text-left"
      >
        <span className="font-sans text-[13px] font-semibold text-ink-900">
          {grupo.titulo}
          <span className="font-normal text-ink-500">
            {" "}
            · {pluralizar(grupo.filas.length, "sesión", "sesiones")}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={`shrink-0 text-ink-500 transition-transform duration-[var(--duration-fast)] ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>

      {abierto ? (
        // Cascada al abrir el mes: las ocho primeras entran escalonadas y el
        // resto queda quieto. Con veinte sesiones en un mes, encadenar los
        // veinte retrasos se sentiría como que la app tarda en responder.
        <ListaEnCascada
          id={panelId}
          contenedor="ul"
          item="li"
          className="mt-3 flex flex-col gap-3"
        >
          {grupo.filas.map((fila) =>
            fila.tipo === "hoy" ? (
              <FilaDeHoySinNota key={fila.clave} turno={fila.turno} hoy={hoy} />
            ) : (
              <FilaSesion
                key={fila.clave}
                sesion={fila.doc}
                hoy={hoy.turno?.id === fila.doc.turnoId ? hoy : null}
              />
            ),
          )}
        </ListaEnCascada>
      ) : null}
    </section>
  );
}

/** El turno de hoy cuando su sesión todavía no tiene nota: sin grabar, en
 *  proceso o fallida. Misma fila que las demás, destacada, con su acción. */
function FilaDeHoySinNota({ turno, hoy }: { turno: Turno; hoy: Hoy }) {
  const { sesion, cargando, paciente } = hoy;
  // En proceso el indicador de abajo ya lo dice con el nombre: el chip
  // repetiría lo mismo con otras palabras.
  const chip =
    sesion && !enProceso(sesion.estado) ? chipDeEstado(sesion.estado) : null;

  let accion: React.ReactNode;
  if (cargando) {
    accion = <p className="font-sans text-[13px] text-ink-500">Cargando…</p>;
  } else if (!sesion || sesion.estado === "grabando") {
    accion = (
      <Link href={`/grabar/${turno.id}`} className={ENLACE_PRIMARIO}>
        <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
        {GRABAR_SESION}
      </Link>
    );
  } else if (sesion.estado === "subiendo" || sesion.estado === "procesando") {
    accion = <IndicadorProcesando paciente={paciente} className="w-full" />;
  } else if (sesion.estado === "revision") {
    // La lista todavía no la trajo con su nota (se está volviendo a pedir).
    accion = (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_PRIMARIO}>
        {REVISAR_NOTA}
      </Link>
    );
  } else if (sesion.estado === "aprobada") {
    accion = esDeudaPendiente(turno) ? (
      <Button variant="primary" onClick={hoy.onCobrar}>
        Cobrar
      </Button>
    ) : (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_SECUNDARIO}>
        {VER_NOTA}
      </Link>
    );
  } else {
    accion = (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_SECUNDARIO}>
        Ver
      </Link>
    );
  }

  return (
    <div
      id={sesion ? `sesion-${sesion.id}` : undefined}
      data-sesion-id={sesion?.id}
      className={FILA_DE_HOY}
    >
      <MarcaDeHoy />
      <span className="font-display text-[15px] font-medium text-ink-900">
        {fechaLarga(turno.fecha)} · {hora(turno.fecha)}
      </span>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-sans text-[12px] text-ink-500 tabular-nums">
          {turno.duracion} min · {modalidadTexto(turno.modalidad)}
        </span>
        {chip ? (
          <Chip variant={chip.variant} size="sm">
            {chip.label}
          </Chip>
        ) : null}
      </div>
      <div className="flex pt-1 sm:justify-start">{accion}</div>
    </div>
  );
}

// La fila de una sesión, con dos destinos.
//
// La tarjeta entera sigue llevando a la nota: es lo que ella toca sin mirar.
// Pero desde esta lista también se llega a "Para vos" —la tercera entrada a
// la vista, junto con el selector de la nota y el aviso de después de
// aprobar—, porque buscar el análisis de una sesión de la semana pasada
// empieza acá y no en la nota de esa sesión.
//
// POR QUÉ LA TARJETA DEJÓ DE SER UN <Link>
//
// Un enlace adentro de otro enlace no es HTML válido y el navegador lo
// desarma. El patrón es el de siempre: la tarjeta es un contenedor
// `relative`, el enlace principal se estira sobre ella con `absolute
// inset-0` —así el área tocable no cambia— y el enlace secundario va encima,
// con su propio `relative`. El foco de teclado sigue llegando a los dos, en
// orden.
//
// El título lleva fecha Y hora: dos sesiones del mismo día se distinguen sin
// leer la letra chica. El resumen va entero —sin line-clamp—: es texto
// clínico y cortarlo con tres puntos es decidir por ella qué no lee.
//
// `hoy` viene cuando esta sesión es la del turno de hoy: se destaca en su
// lugar y, si tiene algo pendiente (revisar, cobrar), el botón va adentro.
function FilaSesion({ sesion, hoy }: { sesion: DocSesion; hoy: Hoy | null }) {
  const fecha = new Date(sesion.fecha);
  const resumen = resumenCorto(sesion.datos) || temasDeLaSesion(sesion.datos);
  const esRevision = sesion.estado === "revision";
  const conParaVos = hayParaVos(sesion.feedback);
  const href = `/sesiones/${sesion.sesionClinicaId}`;
  const cobrable = hoy?.turno ? esDeudaPendiente(hoy.turno) : false;

  return (
    <div
      id={`sesion-${sesion.sesionClinicaId}`}
      data-sesion-id={sesion.sesionClinicaId}
      className={hoy ? FILA_DE_HOY : FILA_COMUN}
    >
      {hoy ? <MarcaDeHoy /> : null}
      <span className="font-display text-[15px] font-medium text-ink-900">
        <Link
          href={href}
          className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
        >
          {fechaLarga(fecha)} · {hora(fecha)}
        </Link>
      </span>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-sans text-[12px] text-ink-500 tabular-nums">
          {sesion.duracionMin} min · {modalidadTexto(sesion.modalidad)}
        </span>
        <Chip variant={esRevision ? "gold" : "sage"} size="sm">
          {esRevision ? PARA_REVISAR : NOTA_GUARDADA}
        </Chip>
      </div>
      {resumen ? (
        <p className="font-sans text-[14px] leading-[1.55] text-ink-700">
          {resumen}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {hoy && esRevision ? (
          <Link href={href} className={`relative ${ENLACE_PRIMARIO}`}>
            {REVISAR_NOTA}
          </Link>
        ) : (
          // La tarjeta entera ya es el enlace (el de la fecha, estirado): esto
          // es sólo la seña a la vista de que se puede tocar.
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1 py-1 font-sans text-[13px] font-semibold text-sage-600"
          >
            {esRevision ? REVISAR_NOTA : VER_NOTA}
            <ChevronRight size={14} strokeWidth={1.8} />
          </span>
        )}
        {hoy && !esRevision && cobrable ? (
          <Button variant="primary" size="sm" className="relative" onClick={hoy.onCobrar}>
            Cobrar
          </Button>
        ) : null}
        {conParaVos ? (
          <Link
            href={`${href}/para-vos`}
            className="relative inline-flex min-h-[44px] items-center font-sans text-[13px] font-semibold text-sage-600 transition-colors duration-[var(--duration-fast)] hover:text-sage-700"
          >
            {PARA_VOS}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

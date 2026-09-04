"use client";

// Pestaña Sesiones: la sesión de hoy (un solo botón según estado), el brief
// "Para retomar" y la lista de sesiones, cada una enlazada a /sesiones/[id].
//
// Acá no se graba ni se revisa nada: grabar vive en /grabar/[turnoId] y la
// nota en /sesiones/[id]. La sesión de hoy llega por props (polling del
// hook de grabación en el padre).

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Mic } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Button, Card, Chip } from "@/components/ui";
import { AnilloProgreso, ListaEnCascada } from "@/components/ui/movimiento";
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
  REVISAR_NOTA,
  pluralizar,
} from "@/lib/glosario";
import type { EstadoSesion, NotaSoap } from "@/lib/sesion-clinica/schema";
import type {
  DatosEstructurados,
  EstadoProcesamiento,
  Modalidad,
  SesionClinicaResponse,
  Turno,
} from "@/types/domain";

import { BriefPreSesion } from "./brief-pre-sesion";
import { CobrarSheet } from "./turnos-pagos-tab";

interface SesionesTabProps {
  pacienteId: string;
  turnoHoy: Turno | null;
  sesionHoy: SesionClinicaResponse | null;
  sesionHoyCargando: boolean;
  onTurnoActualizado: () => void;
  onAviso: (mensaje: string) => void;
}

// Ítem de GET /api/pacientes/[id]/documentacion: nota ya ensamblada y
// datosEstructurados parseados en el servidor.
type DocSesion = {
  sesionClinicaId: string;
  turnoId: string;
  fecha: string;
  duracionMin: number;
  duracionAudioSeg: number | null;
  modalidad: Modalidad;
  estado: Extract<EstadoSesion, "revision" | "aprobado">;
  nota: NotaSoap | null;
  datosEstructurados: DatosEstructurados | null;
  aprobadoEn: string | null;
  procesadoEn: string | null;
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
    case "aprobado":
      return { variant: "sage", label: NOTA_GUARDADA };
    case "error":
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

type GrupoMes = { clave: string; titulo: string; sesiones: DocSesion[] };

function tituloDeMes(fecha: Date): string {
  const texto = format(fecha, "LLLL yyyy", { locale: es });
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

/** Agrupa por mes conservando el orden en que vino la lista (la API la manda
 *  de la más reciente a la más vieja). */
function agruparPorMes(sesiones: DocSesion[]): GrupoMes[] {
  const grupos: GrupoMes[] = [];
  for (const sesion of sesiones) {
    const fecha = new Date(sesion.fecha);
    const clave = format(fecha, "yyyy-MM");
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) {
      ultimo.sesiones.push(sesion);
      continue;
    }
    grupos.push({ clave, titulo: tituloDeMes(fecha), sesiones: [sesion] });
  }
  return grupos;
}

const ENLACE_PRIMARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-sage-500 px-5 font-sans text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-sage-600 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30";
const ENLACE_SECUNDARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-white px-5 font-sans text-[14px] font-semibold text-ink-900 transition-colors duration-150 hover:bg-cream-50 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20";

export function SesionesTab({
  pacienteId,
  turnoHoy,
  sesionHoy,
  sesionHoyCargando,
  onTurnoActualizado,
  onAviso,
}: SesionesTabProps) {
  const [lista, setLista] = React.useState<ListaState>(() => listaInicial(pacienteId));
  const [reloadKey, setReloadKey] = React.useState(0);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);

  const listaActual =
    lista.pacienteId === pacienteId ? lista : listaInicial(pacienteId);

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
  }, [pacienteId, reloadKey]);

  // La sesión de hoy ya está arriba: la lista no la repite.
  const sesionesListadas = React.useMemo(
    () =>
      sesionHoy
        ? listaActual.docs.filter((d) => d.sesionClinicaId !== sesionHoy.id)
        : listaActual.docs,
    [listaActual.docs, sesionHoy],
  );

  const grupos = React.useMemo(
    () => agruparPorMes(sesionesListadas),
    [sesionesListadas],
  );

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
      {turnoHoy ? (
        <SesionDeHoy
          turno={turnoHoy}
          sesion={sesionHoy}
          cargando={sesionHoyCargando}
          onCobrar={() => setCobroTarget(turnoHoy)}
        />
      ) : null}

      <BriefPreSesion pacienteId={pacienteId} />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[20px] font-medium tracking-[-0.01em] text-ink-900">
            Sesiones
          </h2>
          {listaActual.totalSesiones > 0 ? (
            <span className="font-sans text-[12px] text-ink-500">
              {pluralizar(listaActual.totalSesiones, "sesión", "sesiones")}
            </span>
          ) : null}
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

        {!listaActual.loading && listaActual.docs.length === 0 && !listaActual.error ? (
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
                abiertoPorDefecto={indice === 0}
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
          onAviso("Cobrado");
          onTurnoActualizado();
        }}
        onError={onAviso}
      />
    </div>
  );
}

function SesionDeHoy({
  turno,
  sesion,
  cargando,
  onCobrar,
}: {
  turno: Turno;
  sesion: SesionClinicaResponse | null;
  cargando: boolean;
  onCobrar: () => void;
}) {
  const chip = sesion ? chipDeEstado(sesion.estado) : null;
  const cobrable = turno.estado === "realizado" && turno.pagoEstado === "pendiente";

  let accion: React.ReactNode = null;
  if (cargando) {
    accion = <p className="font-sans text-[13px] text-ink-500">Cargando…</p>;
  } else if (!sesion || sesion.estado === "pendiente" || sesion.estado === "grabando") {
    accion = (
      <Link href={`/grabar/${turno.id}`} className={ENLACE_PRIMARIO}>
        <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
        {GRABAR_SESION}
      </Link>
    );
  } else if (sesion.estado === "subiendo" || sesion.estado === "procesando") {
    accion = (
      <div className="flex items-center gap-3 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-3">
        <AnilloProgreso
          tamano={16}
          className="shrink-0 text-sage-500"
          etiqueta={ESCRIBIENDO_NOTA}
        />
        <span className="font-sans text-[13px] text-ink-700">{ESCRIBIENDO_NOTA}</span>
      </div>
    );
  } else if (sesion.estado === "revision") {
    accion = (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_PRIMARIO}>
        {REVISAR_NOTA}
      </Link>
    );
  } else if (sesion.estado === "aprobado") {
    accion = cobrable ? (
      <Button variant="primary" onClick={onCobrar}>
        Cobrar
      </Button>
    ) : (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_SECUNDARIO}>
        Ver nota
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
    <section className="flex flex-col gap-4 rounded-lg border border-sage-200 bg-sage-50 p-5 lg:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-sage-700">
            Hoy
          </span>
          <span className="font-display italic text-[20px] font-medium leading-tight text-ink-900 lg:text-[22px]">
            Sesión a las {hora(turno.fecha)}
          </span>
          <span className="font-sans text-[12px] text-ink-500 tabular-nums">
            {turno.duracion} min · {turno.modalidad === "online" ? "Online" : "Presencial"}
          </span>
        </div>
        {chip ? (
          <Chip variant={chip.variant} size="sm">
            {chip.label}
          </Chip>
        ) : null}
      </div>
      <div className="flex sm:justify-start">{accion}</div>
    </section>
  );
}

/** Un mes de la lista. El más reciente arranca abierto; los anteriores,
 *  plegados, con la cuenta del mes a la vista para no tener que abrirlos. */
function GrupoDeMes({
  grupo,
  abiertoPorDefecto,
}: {
  grupo: GrupoMes;
  abiertoPorDefecto: boolean;
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
            · {pluralizar(grupo.sesiones.length, "sesión", "sesiones")}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={`shrink-0 text-ink-500 transition-transform duration-150 ${
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
          {grupo.sesiones.map((sesion) => (
            <FilaSesion key={sesion.sesionClinicaId} sesion={sesion} />
          ))}
        </ListaEnCascada>
      ) : null}
    </section>
  );
}

function FilaSesion({ sesion }: { sesion: DocSesion }) {
  const fecha = new Date(sesion.fecha);
  const resumen =
    resumenCorto(sesion.datosEstructurados) ||
    temasDeLaSesion(sesion.datosEstructurados);
  const esRevision = sesion.estado === "revision";

  return (
    <Link
      href={`/sesiones/${sesion.sesionClinicaId}`}
      className="flex flex-col gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-white px-4 py-4 transition-colors duration-150 hover:bg-cream-50 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20 sm:px-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[15px] font-medium text-ink-900">
            {fechaLarga(fecha)}
          </span>
          <span className="font-sans text-[12px] text-ink-500 tabular-nums">
            {hora(fecha)} · {sesion.duracionMin} min ·{" "}
            {sesion.modalidad === "online" ? "Online" : "Presencial"}
          </span>
        </div>
        <Chip variant={esRevision ? "gold" : "sage"} size="sm">
          {esRevision ? PARA_REVISAR : NOTA_GUARDADA}
        </Chip>
      </div>
      {resumen ? (
        <p className="line-clamp-2 font-sans text-[14px] leading-[1.55] text-ink-700">
          {resumen}
        </p>
      ) : null}
    </Link>
  );
}

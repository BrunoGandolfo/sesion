"use client";

// Las filas de la pestaña Sesiones: un mes plegable, la fila de una sesión
// con nota y la del turno de hoy que todavía no la tiene.

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Mic } from "lucide-react";

import { Button, Chip } from "@/components/ui";
import { IndicadorProcesando } from "@/components/ui/procesando";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { hayParaVos } from "@/components/grabacion/FeedbackTerapeutaView";
import { sePuedeCobrar } from "@/app/api/_lib/domain";
import { enProceso } from "@/lib/notas-en-proceso";
import { esGrabacionSinTerminar, puede } from "@/lib/sesion-clinica/estados";
import { fechaLarga, hora } from "@/lib/format";
import {
  COBRAR,
  CARGANDO,
  GRABAR_SESION,
  GRABACION_SIN_TERMINAR,
  MODALIDAD_LABEL,
  NOTA_GUARDADA,
  PARA_REVISAR,
  PARA_VOS,
  REVISAR_NOTA,
  SESION_DE_HOY,
  VER_NOTA,
  pluralizar,
} from "@/lib/glosario";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import type { Modalidad, Turno } from "@/types/domain";

import {
  chipDeEstado,
  resumenCorto,
  temasDeLaSesion,
  type DocSesion,
  type GrupoMes,
} from "./sesiones-datos";

const ENLACE_PRIMARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-sage-500 px-5 font-sans text-[14px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:bg-sage-600 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30";
const ENLACE_SECUNDARIO =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-white px-5 font-sans text-[14px] font-semibold text-ink-900 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20";

/** Lo que las filas necesitan saber de la sesión de hoy. */
export type Hoy = {
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
  return MODALIDAD_LABEL[modalidad];
}

/** Un mes de la lista. El más reciente arranca abierto; los anteriores,
 *  plegados, con la cuenta del mes a la vista para no tener que abrirlos. */
export function GrupoDeMes({
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
  // Grabación o subida que quedó a medias (esGrabacionSinTerminar). Se dice así
  // (no "Grabando…" ni "Procesando") y se ofrece grabar, que retoma la
  // copia guardada en el teléfono.
  const sinTerminar = esGrabacionSinTerminar(sesion, new Date());
  const chip = sinTerminar
    ? { variant: "terracotta" as const, label: GRABACION_SIN_TERMINAR }
    : sesion && !enProceso(sesion.estado)
      ? chipDeEstado(sesion.estado)
      : null;

  let accion: React.ReactNode;
  if (cargando) {
    accion = <p className="font-sans text-[13px] text-ink-500">{CARGANDO}</p>;
  } else if (!sesion || puede("empezar_subida", sesion.estado) || sinTerminar) {
    accion = (
      <Link href={`/grabar/${turno.id}`} className={ENLACE_PRIMARIO}>
        <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
        {GRABAR_SESION}
      </Link>
    );
  } else if (enProceso(sesion.estado)) {
    accion = <IndicadorProcesando paciente={paciente} className="w-full" />;
  } else if (puede("aprobar", sesion.estado)) {
    // La lista todavía no la trajo con su nota (se está volviendo a pedir).
    accion = (
      <Link href={`/sesiones/${sesion.id}`} className={ENLACE_PRIMARIO}>
        {REVISAR_NOTA}
      </Link>
    );
  } else if (sesion.estado === "aprobada") {
    accion = sePuedeCobrar(turno, new Date()) ? (
      <Button variant="primary" onClick={hoy.onCobrar}>
        {COBRAR}
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
      <span className="tabular-nums text-[15px] font-medium text-ink-900">
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
  const cobrable = hoy?.turno ? sePuedeCobrar(hoy.turno, new Date()) : false;

  return (
    <div
      id={`sesion-${sesion.sesionClinicaId}`}
      data-sesion-id={sesion.sesionClinicaId}
      className={hoy ? FILA_DE_HOY : FILA_COMUN}
    >
      {hoy ? <MarcaDeHoy /> : null}
      <span className="tabular-nums text-[15px] font-medium text-ink-900">
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
            {COBRAR}
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

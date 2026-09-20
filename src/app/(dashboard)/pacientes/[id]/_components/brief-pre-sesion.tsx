"use client";

// "Preparar sesión": el resumen que la psicóloga lee un minuto antes de que
// entre la paciente. Datos del endpoint /brief (composición determinística de
// notas aprobadas + el resumen del proceso) — nada se genera acá.
//
// PLEGADO, Y DÓNDE
//
// Estaba abierto arriba de la lista de sesiones y la empujaba dos pantallas
// hacia abajo. Ahora es un botón en el renglón del título de la lista, y su
// contenido se despliega debajo de ese renglón: cerrado no ocupa alto. Por eso
// este componente devuelve un fragmento (botón + panel) y no una tarjeta: el
// renglón es un flex con wrap de sesiones-tab.tsx y el panel pide el ancho
// entero (`basis-full`).
//
// CONTRATO: con `abrir` (la ficha se pidió con ?preparar=1, desde Hoy o
// Agenda) arranca abierto y se trae a la vista cuando el resumen llegó.
//
// Lo único que no se pliega es la señal de riesgo: si la hay, se dice al lado
// del botón, cerrado o abierto.
//
// Nada se recorta: el resumen, el recorrido y los objetivos van enteros. Quien
// abre este bloque vino a leerlo.

import * as React from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

import { ETIQUETA_NIVEL } from "@/components/clinico/brief-corto";
import { Chip } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaCorta, fechaRelativa, hora } from "@/lib/format";
import {
  EL_RECORRIDO_HASTA_HOY,
  PARA_LA_PROXIMA,
  PREPARAR_SESION,
  SENAL_DE_RIESGO,
  pluralizar,
} from "@/lib/glosario";
import type { NivelRiesgo } from "@/types/domain";

type UltimaSesionBrief = {
  fecha: string;
  pendienteAprobacion: boolean;
  resumenSesion: string | null;
  focoProximaSesion: string | null;
  progresoPercibido: string | null;
  temas: string[];
  riesgo: {
    flagsActivos: string[];
    nivel: NivelRiesgo;
    indicadores: string[];
    notaParaTerapeuta: string | null;
  };
};

type HiloLongitudinalBrief = {
  resumenAcumulativo: string | null;
  hipotesisDiagnostica: string | null;
  temasRecurrentes: { tema: string; conteo: number }[];
  objetivosActivos: string[];
  riesgosHistoricos: { fecha: string; flag: string; detalle?: string }[];
  revisadoPorTerapeuta: boolean;
};

type BriefResponse = {
  pacienteId: string;
  propuestaPendiente: boolean;
  notaPendiente: boolean;
  ultimaSesion: UltimaSesionBrief | null;
  hiloLongitudinal: HiloLongitudinalBrief | null;
  proximoTurno: {
    fecha: string;
    duracion: number;
    modalidad: string;
  } | null;
};

// Los nombres de los flags salen de formatearEtiqueta y los del nivel de
// ETIQUETA_NIVEL (brief-corto): acá había una tercera copia de las dos
// tablas, con "Riesgo a terceros" donde el resto de la app dice "Violencia
// hacia terceros".

// Brief atado al paciente que lo cargó: si cambia el id, el anterior deja de
// aplicar por derivación, sin resetear estado en un efecto.
type BriefCargado = { pacienteId: string; brief: BriefResponse };

export function BriefPreSesion({
  pacienteId,
  abrir = false,
}: {
  pacienteId: string;
  /** La ficha se pidió con ?preparar=1: abierto y a la vista al cargar. */
  abrir?: boolean;
}) {
  const [cargado, setCargado] = React.useState<BriefCargado | null>(null);
  const [open, setOpen] = React.useState(abrir);
  const panelId = React.useId();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const yaSeMostro = React.useRef(false);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<BriefResponse>(`/api/pacientes/${pacienteId}/brief`, {
      signal: controller.signal,
    })
      .then((brief) => setCargado({ pacienteId, brief }))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        // Sin brief no hay bloque: la pestaña sigue funcionando sin él.
      });
    return () => controller.abort();
  }, [pacienteId]);

  const brief = cargado?.pacienteId === pacienteId ? cargado.brief : null;

  // Una sola vez, cuando el resumen llegó: después ella scrollea a donde quiera.
  React.useEffect(() => {
    if (!abrir || !brief || yaSeMostro.current) return;
    yaSeMostro.current = true;
    panelRef.current?.scrollIntoView?.({ block: "start" });
  }, [abrir, brief]);

  if (!brief) return null;

  const { ultimaSesion, hiloLongitudinal, proximoTurno } = brief;

  const registrosRiesgo = hiloLongitudinal?.riesgosHistoricos.length ?? 0;
  const riesgoUltima =
    ultimaSesion !== null &&
    (ultimaSesion.riesgo.nivel !== "ninguno" ||
      ultimaSesion.riesgo.flagsActivos.length > 0);
  const hayRiesgo = riesgoUltima || registrosRiesgo > 0;

  const boton = (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {hayRiesgo ? (
        <span className="inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold text-terracotta-500">
          <AlertTriangle size={15} strokeWidth={1.9} aria-hidden="true" />
          {SENAL_DE_RIESGO}
        </span>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-white px-4 font-sans text-[14px] font-semibold text-ink-900 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20"
      >
        {PREPARAR_SESION}
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={`shrink-0 text-ink-500 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );

  const PANEL =
    "basis-full scroll-mt-[72px] rounded-lg border border-[color:var(--border-subtle)] bg-white p-5 lg:p-6";

  if (!ultimaSesion && !hiloLongitudinal) {
    return (
      <>
        {boton}
        {open ? (
          <div id={panelId} ref={panelRef} className={PANEL}>
            <p className="font-display italic text-[16px] leading-[1.5] text-ink-700">
              Todavía no hay recorrido para retomar.
            </p>
            <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink-500">
              Cuando apruebes la primera nota de sesión, acá vas a tener el
              resumen del proceso antes de cada encuentro.
            </p>
            {brief.propuestaPendiente ? <p className="mt-3 text-sm">Hay una propuesta del Recorrido sin revisar.</p> : null}
            {brief.notaPendiente ? <p className="mt-3 text-sm">Hay una nota pendiente de aprobación.</p> : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {boton}

      {open ? (
        <div id={panelId} ref={panelRef} className={`${PANEL} flex flex-col gap-5`}>
          {proximoTurno ? (
            <p className="font-sans text-[12px] text-ink-500 tabular-nums">
              Próxima: {fechaCorta(new Date(proximoTurno.fecha))} ·{" "}
              {hora(new Date(proximoTurno.fecha))}
            </p>
          ) : null}
          {brief.propuestaPendiente ? <p className="text-sm">Hay una propuesta del Recorrido sin revisar. Este resumen usa la versión vigente.</p> : null}
          {brief.notaPendiente ? <p className="text-sm">Hay una nota pendiente de aprobación; todavía no se incorpora a este resumen.</p> : null}
          {hayRiesgo ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3"
            >
              <AlertTriangle
                size={18}
                strokeWidth={1.9}
                aria-hidden="true"
                className="mt-[2px] shrink-0 text-terracotta-500"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
                  {SENAL_DE_RIESGO}
                </p>
                {ultimaSesion && riesgoUltima ? (
                  <p className="font-sans text-[13px] leading-[1.55] text-ink-900">
                    Última sesión:{" "}
                    {ultimaSesion.riesgo.flagsActivos.length > 0
                      ? ultimaSesion.riesgo.flagsActivos
                          .map(formatearEtiqueta)
                          .join(", ")
                      : ultimaSesion.riesgo.indicadores.join(", ")}
                    {ultimaSesion.riesgo.nivel !== "ninguno"
                      ? ` (${ETIQUETA_NIVEL[ultimaSesion.riesgo.nivel]})`
                      : ""}
                    {ultimaSesion.riesgo.notaParaTerapeuta
                      ? ` — ${ultimaSesion.riesgo.notaParaTerapeuta}`
                      : ""}
                  </p>
                ) : null}
                {registrosRiesgo > 0 ? (
                  <p className="font-sans text-[12px] leading-[1.5] text-ink-700">
                    Antes:{" "}
                    {pluralizar(registrosRiesgo, "señal registrada", "señales registradas")}{" "}
                    en el proceso.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {ultimaSesion ? (
            <div className="flex flex-col gap-3">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Última nota aprobada —{" "}
                {fechaRelativa(new Date(ultimaSesion.fecha)).toLowerCase()}
              </p>
              {ultimaSesion.resumenSesion ? (
                <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
                  {ultimaSesion.resumenSesion}
                </p>
              ) : null}
              {ultimaSesion.progresoPercibido ? (
                <p className="font-sans text-[13px] leading-[1.5] text-ink-700">
                  Progreso percibido: {ultimaSesion.progresoPercibido}
                </p>
              ) : null}
              {ultimaSesion.focoProximaSesion ? (
                <div className="rounded-md border-l-2 border-l-gold-500 bg-cream-100 px-4 py-3">
                  <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-gold-500">
                    {PARA_LA_PROXIMA}
                  </p>
                  <p className="mt-1 font-display italic text-[16px] leading-[1.5] text-ink-900">
                    {ultimaSesion.focoProximaSesion}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {hiloLongitudinal &&
          (hiloLongitudinal.resumenAcumulativo ||
            hiloLongitudinal.temasRecurrentes.length > 0 ||
            hiloLongitudinal.objetivosActivos.length > 0) ? (
            <div className="flex flex-col gap-3 border-t border-[color:var(--border-subtle)] pt-4">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                {EL_RECORRIDO_HASTA_HOY}
                {!hiloLongitudinal.revisadoPorTerapeuta
                  ? " · actualizado tras la última sesión, revisalo"
                  : ""}
              </p>
              {hiloLongitudinal.resumenAcumulativo ? (
                <p className="font-sans text-[13px] leading-[1.6] text-ink-700">
                  {hiloLongitudinal.resumenAcumulativo}
                </p>
              ) : null}
              {hiloLongitudinal.objetivosActivos.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {hiloLongitudinal.objetivosActivos.map((o) => (
                    <li key={o} className="font-sans text-[13px] leading-[1.5] text-ink-900">
                      · {o}
                    </li>
                  ))}
                </ul>
              ) : null}
              {hiloLongitudinal.temasRecurrentes.length > 0 ? (
                // Texto libre, no estado: un tema del hilo puede medir una
                // línea entera y acá envuelve en vez de recortarse contra el
                // borde de la pantalla. Es el mismo dibujo que el Recorrido.
                <div className="flex flex-wrap gap-1.5">
                  {hiloLongitudinal.temasRecurrentes.map(({ tema, conteo }) => (
                    <Chip key={tema} variant="neutral" size="sm" texto="libre">
                      <span className="font-semibold">{formatearEtiqueta(tema)}</span>
                      <span className="ml-1 text-ink-500">· {conteo}</span>
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {ultimaSesion?.pendienteAprobacion ? (
            <p className="font-sans text-[12px] leading-[1.5] text-gold-500">
              La última nota está para revisar: lo de arriba puede cambiar
              cuando la apruebes.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

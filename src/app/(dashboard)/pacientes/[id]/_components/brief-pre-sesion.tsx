"use client";

// Card "Para retomar": brief pre-sesión que la psicóloga lee 1 minuto antes
// de que entre el paciente. Datos del endpoint /brief (composición
// determinística de notas aprobadas + el hilo) — nada se genera acá.

import * as React from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

import { ETIQUETA_NIVEL } from "@/components/clinico/brief-corto";
import { Chip, EditorialRule } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaCorta, fechaRelativa, hora } from "@/lib/format";
import {
  EL_HILO,
  PARA_LA_PROXIMA,
  PARA_RETOMAR,
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

export function BriefPreSesion({ pacienteId }: { pacienteId: string }) {
  const [cargado, setCargado] = React.useState<BriefCargado | null>(null);
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<BriefResponse>(`/api/pacientes/${pacienteId}/brief`, {
      signal: controller.signal,
    })
      .then((brief) => setCargado({ pacienteId, brief }))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        // Sin brief no hay card: la pestaña sigue funcionando sin él.
      });
    return () => controller.abort();
  }, [pacienteId]);

  const brief = cargado?.pacienteId === pacienteId ? cargado.brief : null;
  if (!brief) return null;

  const { ultimaSesion, hiloLongitudinal, proximoTurno } = brief;

  if (!ultimaSesion && !hiloLongitudinal) {
    return (
      <section className="rounded-lg border border-[color:var(--border-subtle)] bg-cream-50 p-5 lg:p-6">
        <h2 className="flex items-center">
          <EditorialRule />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {PARA_RETOMAR}
          </span>
        </h2>
        <p className="mt-3 font-display italic text-[16px] leading-[1.5] text-ink-700">
          Todavía no hay recorrido para retomar.
        </p>
        <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink-500">
          Cuando apruebes la primera nota de sesión, acá vas a tener el hilo
          del proceso antes de cada encuentro.
        </p>
      </section>
    );
  }

  const registrosRiesgo = hiloLongitudinal?.riesgosHistoricos.length ?? 0;
  const riesgoUltima =
    ultimaSesion !== null &&
    (ultimaSesion.riesgo.nivel !== "ninguno" ||
      ultimaSesion.riesgo.flagsActivos.length > 0);
  const hayRiesgo = riesgoUltima || registrosRiesgo > 0;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-5 lg:p-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <h2 className="flex min-w-0 items-center">
          <EditorialRule />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {PARA_RETOMAR}
          </span>
        </h2>
        <span className="flex shrink-0 items-center gap-3">
          {proximoTurno ? (
            <span className="hidden font-sans text-[12px] text-ink-500 tabular-nums sm:inline">
              Próxima: {fechaCorta(new Date(proximoTurno.fecha))} ·{" "}
              {hora(new Date(proximoTurno.fecha))}
            </span>
          ) : null}
          <ChevronDown
            size={18}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`shrink-0 text-ink-500 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {open ? (
        <div className="mt-4 flex flex-col gap-5">
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
                Última sesión —{" "}
                {fechaRelativa(new Date(ultimaSesion.fecha)).toLowerCase()}
              </p>
              {ultimaSesion.resumenSesion ? (
                <p className="line-clamp-3 font-sans text-[14px] leading-[1.6] text-ink-900">
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
                {EL_HILO}
                {!hiloLongitudinal.revisadoPorTerapeuta
                  ? " · actualizado tras la última sesión, revisalo"
                  : ""}
              </p>
              {hiloLongitudinal.resumenAcumulativo ? (
                <p className="line-clamp-3 font-sans text-[13px] leading-[1.6] text-ink-700">
                  {hiloLongitudinal.resumenAcumulativo}
                </p>
              ) : null}
              {hiloLongitudinal.objetivosActivos.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {hiloLongitudinal.objetivosActivos.slice(0, 3).map((o) => (
                    <li key={o} className="font-sans text-[13px] leading-[1.5] text-ink-900">
                      · {o}
                    </li>
                  ))}
                </ul>
              ) : null}
              {hiloLongitudinal.temasRecurrentes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {hiloLongitudinal.temasRecurrentes.map(({ tema, conteo }) => (
                    <Chip key={tema} variant="neutral" size="sm">
                      {tema} · {conteo}
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
    </section>
  );
}

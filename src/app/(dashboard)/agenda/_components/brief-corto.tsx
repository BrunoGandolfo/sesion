"use client";

// Brief pre-sesión en modo corto, para el sheet del turno.
//
// Es la versión de dos o tres líneas de "Para retomar"
// (pacientes/[id]/_components/brief-pre-sesion.tsx): misma fuente
// (/api/pacientes/[id]/brief, composición determinística de notas
// aprobadas), sin desplegables ni hilo completo. Lo que hace falta leer un
// minuto antes de que entre la paciente: si hay riesgo a la vista, de qué
// se habló la última vez y qué foco quedó sugerido.

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { EditorialRule } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { fechaRelativa } from "@/lib/format";
import { PARA_LA_PROXIMA, PARA_RETOMAR, SENAL_DE_RIESGO } from "@/lib/glosario";
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
};

const FLAG_LABELS: Record<string, string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Riesgo a terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

const NIVEL_LABELS: Record<NivelRiesgo, string> = {
  ninguno: "sin señal",
  bajo: "nivel bajo",
  moderado: "nivel moderado",
  alto: "nivel alto",
};

type Estado =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "listo"; brief: BriefResponse };

export function BriefCorto({ pacienteId }: { pacienteId: string }) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: "cargando" });

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<BriefResponse>(`/api/pacientes/${pacienteId}/brief`, {
      signal: controller.signal,
    })
      .then((brief) => setEstado({ tipo: "listo", brief }))
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setEstado({ tipo: "error" });
      });
    return () => controller.abort();
  }, [pacienteId]);

  if (estado.tipo === "cargando") {
    return (
      <Marco>
        <p className="mt-2 text-[13px] text-ink-500">Cargando…</p>
      </Marco>
    );
  }

  // El brief es apoyo, no bloquea el turno: si no llega, el sheet sigue.
  if (estado.tipo === "error") return null;

  const { ultimaSesion, hiloLongitudinal } = estado.brief;

  if (!ultimaSesion && !hiloLongitudinal) {
    return (
      <Marco>
        <p className="mt-2 font-display text-[15px] italic leading-[1.5] text-ink-700">
          Todavía no hay recorrido para retomar.
        </p>
      </Marco>
    );
  }

  const riesgoUltima =
    ultimaSesion &&
    (ultimaSesion.riesgo.nivel !== "ninguno" ||
      ultimaSesion.riesgo.flagsActivos.length > 0);
  const riesgosHistoricos = hiloLongitudinal?.riesgosHistoricos.length ?? 0;

  return (
    <Marco
      extra={
        <Link
          href={`/pacientes/${pacienteId}`}
          className="text-[12px] font-semibold text-sage-600 hover:underline"
        >
          Ver ficha
        </Link>
      }
    >
      <div className="mt-2 flex flex-col gap-2">
        {riesgoUltima || riesgosHistoricos > 0 ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-2 text-[13px] leading-[1.5] text-ink-900"
          >
            <AlertTriangle
              size={16}
              strokeWidth={1.9}
              aria-hidden="true"
              className="mt-[2px] shrink-0 text-terracotta-500"
            />
            <span>
              <span className="font-semibold text-terracotta-600">
                {SENAL_DE_RIESGO}:{" "}
              </span>
              {riesgoUltima && ultimaSesion
                ? `${
                    ultimaSesion.riesgo.flagsActivos.length > 0
                      ? ultimaSesion.riesgo.flagsActivos
                          .map((f) => FLAG_LABELS[f] ?? f)
                          .join(", ")
                      : ultimaSesion.riesgo.indicadores.join(", ")
                  }${
                    ultimaSesion.riesgo.nivel !== "ninguno"
                      ? ` (${NIVEL_LABELS[ultimaSesion.riesgo.nivel]})`
                      : ""
                  }`
                : `${riesgosHistoricos} ${
                    riesgosHistoricos === 1 ? "registro" : "registros"
                  } en el proceso`}
            </span>
          </p>
        ) : null}

        {ultimaSesion ? (
          <>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Última sesión,{" "}
                {fechaRelativa(new Date(ultimaSesion.fecha)).toLowerCase()}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.55] text-ink-900">
                {ultimaSesion.resumenSesion ??
                  (ultimaSesion.temas.length > 0
                    ? ultimaSesion.temas.join(", ")
                    : "Sin resumen todavía.")}
              </p>
            </div>
            {ultimaSesion.focoProximaSesion ? (
              <p className="line-clamp-2 border-l-2 border-l-gold-500 pl-3 font-display text-[14px] italic leading-[1.5] text-ink-900">
                <span className="font-sans text-[11px] font-semibold not-italic uppercase tracking-[0.08em] text-gold-500">
                  {PARA_LA_PROXIMA}
                </span>{" "}
                {ultimaSesion.focoProximaSesion}
              </p>
            ) : null}
            {ultimaSesion.pendienteAprobacion ? (
              <p className="text-[12px] leading-[1.5] text-gold-500">
                La última nota todavía no está aprobada: esto puede cambiar.
              </p>
            ) : null}
          </>
        ) : hiloLongitudinal?.resumenAcumulativo ? (
          <p className="line-clamp-2 text-[13px] leading-[1.55] text-ink-700">
            {hiloLongitudinal.resumenAcumulativo}
          </p>
        ) : null}
      </div>
    </Marco>
  );
}

function Marco({
  children,
  extra,
}: {
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center">
          <EditorialRule />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {PARA_RETOMAR}
          </span>
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

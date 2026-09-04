"use client";

// Brief corto: las dos líneas que se leen de pie, con la paciente entrando.
//
// Una sola versión para las dos pantallas que lo mostraban por separado —
// la card AHORA de Hoy y el sheet del turno en la agenda—, que hasta ahora
// eran dos componentes distintos con el mismo contenido y dos copias de las
// etiquetas de riesgo.
//
// Fuente: /api/pacientes/[id]/brief (composición determinística de notas
// aprobadas). Acá no se genera nada: se elige qué mostrar y en qué orden —
// primero la señal de riesgo, después de qué se habló, después el foco.
//
// La versión completa ("Para retomar", pacientes/[id]/_components/
// brief-pre-sesion.tsx) sigue viviendo en la ficha y no se toca.

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { EditorialRule } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { fechaRelativa } from "@/lib/format";
import {
  PARA_LA_PROXIMA,
  PARA_RETOMAR,
  SENAL_DE_RIESGO,
  VER_FICHA,
  pluralizar,
} from "@/lib/glosario";
import type { NivelRiesgo } from "@/types/domain";

/** Nombres de las señales de riesgo, en el orden en que las nombra la nota. */
export const ETIQUETA_FLAG: Record<string, string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Riesgo a terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

/** Cómo se dice cada nivel de la señal graduada. */
export const ETIQUETA_NIVEL: Record<NivelRiesgo, string> = {
  ninguno: "sin señal",
  bajo: "nivel bajo",
  moderado: "nivel moderado",
  alto: "nivel alto",
};

export interface RiesgoCorto {
  nivel: NivelRiesgo;
  flagsActivos: string[];
  indicadores: string[];
}

/** Lo que el brief corto necesita de `ultimaSesion`. Es un subconjunto del
 *  payload de /brief: los consumidores pasan lo que ya leyeron. */
export interface UltimaSesionCorta {
  /** ISO. */
  fecha: string;
  resumenSesion: string | null;
  focoProximaSesion: string | null;
  riesgo: RiesgoCorto;
  /** Fallback del resumen cuando la nota no lo trae. */
  temas?: string[];
  /** La última nota todavía no se aprobó: lo de arriba puede cambiar. */
  pendienteAprobacion?: boolean;
}

/** true cuando hay algo que avisar: nivel graduado o flag activo. */
export function hayRiesgo(riesgo: RiesgoCorto | undefined | null): boolean {
  return (
    !!riesgo && (riesgo.nivel !== "ninguno" || riesgo.flagsActivos.length > 0)
  );
}

/**
 * Texto de la señal: los flags activos si los hay, si no los indicadores,
 * y entre paréntesis el nivel cuando está graduado. Sin flags ni indicadores
 * de la última sesión cae en los registros históricos, que es lo que muestra
 * el sheet del turno.
 */
export function textoRiesgo(
  riesgo: RiesgoCorto | undefined | null,
  registrosHistoricos = 0,
): string | null {
  if (hayRiesgo(riesgo) && riesgo) {
    const que =
      riesgo.flagsActivos.length > 0
        ? riesgo.flagsActivos.map((f) => ETIQUETA_FLAG[f] ?? f).join(", ")
        : riesgo.indicadores.join(", ");
    const nivel =
      riesgo.nivel !== "ninguno" ? ` (${ETIQUETA_NIVEL[riesgo.nivel]})` : "";
    return `${que}${nivel}`;
  }

  if (registrosHistoricos > 0) {
    return `${pluralizar(
      registrosHistoricos,
      "señal registrada",
      "señales registradas",
    )} en el proceso`;
  }

  return null;
}

export interface BriefCortoProps {
  ultimaSesion: UltimaSesionCorta | null;
  /** Señales de riesgo de sesiones anteriores (hiloLongitudinal). */
  riesgosHistoricos?: number;
  /** Agrega la advertencia de que la última nota todavía no se aprobó. La
   *  card AHORA no la muestra: ahí el brief son dos líneas y nada más. */
  avisarNotaSinAprobar?: boolean;
  className?: string;
}

/**
 * Presentacional: recibe lo que el consumidor ya leyó. La card AHORA lo usa
 * así, porque pide el brief junto con la sesión clínica en una sola tanda.
 */
export function BriefCorto({
  ultimaSesion,
  riesgosHistoricos = 0,
  avisarNotaSinAprobar = false,
  className = "",
}: BriefCortoProps) {
  const aviso = textoRiesgo(ultimaSesion?.riesgo, riesgosHistoricos);

  if (!ultimaSesion && !aviso) return null;

  const resumen =
    ultimaSesion?.resumenSesion ??
    (ultimaSesion?.temas && ultimaSesion.temas.length > 0
      ? ultimaSesion.temas.join(", ")
      : "sin resumen todavía");

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {aviso ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-2.5 font-sans text-[13px] leading-[1.5] text-ink-900"
        >
          <AlertTriangle
            size={16}
            strokeWidth={1.9}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
          <span>
            <span className="font-semibold text-terracotta-600">
              {SENAL_DE_RIESGO}:
            </span>{" "}
            {aviso}
          </span>
        </p>
      ) : null}

      {ultimaSesion ? (
        <p className="line-clamp-2 font-sans text-[13px] leading-[1.5] text-ink-700">
          <span className="text-ink-500">
            Última vez ({fechaRelativa(new Date(ultimaSesion.fecha)).toLowerCase()}):
          </span>{" "}
          {resumen}
        </p>
      ) : null}

      {ultimaSesion?.focoProximaSesion ? (
        <p className="line-clamp-2 font-sans text-[13px] leading-[1.5] text-ink-700">
          <span className="text-ink-500">{PARA_LA_PROXIMA}:</span>{" "}
          {ultimaSesion.focoProximaSesion}
        </p>
      ) : null}

      {avisarNotaSinAprobar && ultimaSesion?.pendienteAprobacion ? (
        <p className="font-sans text-[12px] leading-[1.5] text-gold-500">
          La última nota todavía no está aprobada: esto puede cambiar.
        </p>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Versión con marco y lectura propia, para el sheet del turno.
// ────────────────────────────────────────────────────────────────────────────

type BriefResponse = {
  pacienteId: string;
  ultimaSesion:
    | (UltimaSesionCorta & { riesgo: RiesgoCorto & { notaParaTerapeuta: string | null } })
    | null;
  hiloLongitudinal: {
    resumenAcumulativo: string | null;
    riesgosHistoricos: { fecha: string; flag: string; detalle?: string }[];
  } | null;
};

type Estado =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "listo"; brief: BriefResponse };

/**
 * Mismo brief, con el rótulo "Para retomar" y el enlace a la ficha, para
 * pantallas que no tienen los datos a mano (el sheet del turno).
 */
export function BriefCortoDePaciente({ pacienteId }: { pacienteId: string }) {
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
  const riesgosHistoricos = hiloLongitudinal?.riesgosHistoricos.length ?? 0;

  if (!ultimaSesion && !hiloLongitudinal) {
    return (
      <Marco>
        <p className="mt-2 font-display text-[15px] italic leading-[1.5] text-ink-700">
          Todavía no hay recorrido para retomar.
        </p>
      </Marco>
    );
  }

  return (
    <Marco
      extra={
        <Link
          href={`/pacientes/${pacienteId}`}
          className="text-[12px] font-semibold text-sage-600 hover:underline"
        >
          {VER_FICHA}
        </Link>
      }
    >
      {ultimaSesion || riesgosHistoricos > 0 ? (
        <BriefCorto
          className="mt-2"
          ultimaSesion={ultimaSesion}
          riesgosHistoricos={riesgosHistoricos}
          avisarNotaSinAprobar
        />
      ) : hiloLongitudinal?.resumenAcumulativo ? (
        <p className="mt-2 line-clamp-2 text-[13px] leading-[1.55] text-ink-700">
          {hiloLongitudinal.resumenAcumulativo}
        </p>
      ) : null}
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

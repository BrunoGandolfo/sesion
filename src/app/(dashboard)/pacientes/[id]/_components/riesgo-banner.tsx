"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

const FLAG_KEYS = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

const FLAG_LABELS: Record<FlagKey, string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Riesgo a terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

type FlagsRiesgoApi = Partial<Record<FlagKey, boolean>> & {
  detalle?: string | null;
};

type SesionApi = {
  fecha: string;
  numero: number;
  flagsRiesgo: FlagsRiesgoApi | null;
};

type ProgresoApiResponse = {
  sesiones: SesionApi[];
};

type FlagHit = {
  flag: FlagKey;
  fecha: string;
  numero: number;
  detalle: string;
};

function collectFlags(sesiones: SesionApi[]): FlagHit[] {
  const hits: FlagHit[] = [];
  for (const s of sesiones) {
    if (!s.flagsRiesgo) continue;
    for (const key of FLAG_KEYS) {
      if (s.flagsRiesgo[key] === true) {
        hits.push({
          flag: key,
          fecha: s.fecha,
          numero: s.numero,
          detalle: (s.flagsRiesgo.detalle ?? "").trim(),
        });
      }
    }
  }
  return hits.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function formatFecha(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("es-UY", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .replace(/\.$/, "");
}

export function RiesgoBanner({ pacienteId }: { pacienteId: string }) {
  const [hits, setHits] = React.useState<FlagHit[] | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pacientes/${pacienteId}/progreso`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<ProgresoApiResponse>) : null))
      .then((json) => {
        if (!json) return;
        setHits(collectFlags(json.sesiones));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [pacienteId]);

  if (!hits || hits.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mt-4 lg:mt-5 rounded-lg border border-terracotta-100 bg-terracotta-50/70 px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className="mt-[2px] shrink-0 text-terracotta-500"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
            Flags de riesgo clínico
          </p>
          <ul className="flex flex-col gap-1">
            {hits.map((hit, i) => (
              <li
                key={`${hit.flag}-${hit.numero}-${i}`}
                className="font-sans text-[13px] leading-[1.45] text-ink-700"
              >
                <span aria-hidden="true">🚩 </span>
                <span className="font-semibold text-ink-900">
                  {FLAG_LABELS[hit.flag]} detectada
                </span>
                <span className="text-ink-500"> — Sesión {hit.numero} del </span>
                <span className="tabular-nums text-ink-900">
                  {formatFecha(hit.fecha)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

// Motores SVG genéricos y tipos del payload de /progreso. Cada gráfico vive
// en su propio archivo y compone estas piezas; los cálculos son los mismos
// que tenía progreso-clinico.tsx antes de partirse.

import * as React from "react";

import type { Lectura, TonoLectura } from "../progreso-lecturas";

export const COLOR = {
  sage: "#4F7A6A",
  sageSoft: "#C2D4CB",
  terracotta: "#B26B45",
  terracottaSoft: "#F5E0CC",
  gold: "#A88534",
  goldSoft: "#FAF4E4",
  cream: "#FAFAF6",
  ink: "#1A2628",
  inkSoft: "#A5B0B2",
  mint: "#5DCAA5",
  gray: "#C2C8C9",
} as const;

export type FlagsRiesgo = {
  ideacionSuicida?: boolean;
  autolesion?: boolean;
  [key: string]: boolean | undefined;
};

export type SpeechAnalytics = {
  ratioHablaTerapeuta: number;
  ratioHablaPaciente: number;
  cantidadSilencios: number;
  duracionPromedioSilenciosSeg: number;
  tiempoTotalHablaSeg: number;
  speakersDetectados?: number; // ausente en payloads previos al campo
};

export type SesionProgreso = {
  fecha: string;
  numero: number;
  intensidadEmocional: number;
  alianzaTerapeutica: number;
  alianzaLabel: string;
  temas: string[];
  intervenciones: Record<string, number>;
  flagsRiesgo?: FlagsRiesgo;
  speechAnalytics?: SpeechAnalytics;
  observacionIA?: string;
  progresoPercibido?: string | null;
};

export type ProgresoResponse = {
  pacienteId: string;
  nombre: string;
  apellido: string;
  totalSesiones: number;
  sesiones: SesionProgreso[];
};

const LECTURA_ACCENT: Record<TonoLectura, string> = {
  positivo: COLOR.sage,
  neutral: COLOR.inkSoft,
  atencion: COLOR.terracotta,
};

export function ChartCard({
  title,
  subtitle,
  lectura,
  children,
}: {
  title: string;
  subtitle: string;
  lectura?: Lectura | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-4 lg:p-5">
      <header className="mb-4">
        <h3 className="font-[family-name:var(--font-display)] text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
          {title}
        </h3>
        <p className="mt-1 text-[12px] leading-[1.4] text-ink-500">{subtitle}</p>
      </header>
      {lectura ? (
        <p
          className="mb-4 border-l-2 pl-3 text-[13px] leading-[1.55] text-ink-900"
          style={{ borderLeftColor: LECTURA_ACCENT[lectura.tono] }}
        >
          {lectura.texto}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function sessionLabels(sesiones: SesionProgreso[]): string[] {
  return sesiones.map((s) => `S${s.numero}`);
}

// ============================================
// LineChart genérico
// ============================================
export function LineChart({
  values,
  labels,
  yMin,
  yMax,
  yTicks,
  yLabels,
  color,
  fillColor,
  rupturas,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  yLabels?: string[];
  color: string;
  fillColor: string;
  rupturas?: number[];
  ariaLabel: string;
}) {
  const W = 600;
  const H = 220;
  const padL = yLabels ? 78 : 36;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = values.length;
  const xFor = (i: number) =>
    n === 1 ? padL + innerW / 2 : padL + (i * innerW) / (n - 1);
  const yFor = (v: number) =>
    padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const points = values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
  const areaPath =
    n > 0
      ? `M ${xFor(0)},${padT + innerH} L ${values
          .map((v, i) => `${xFor(i)},${yFor(v)}`)
          .join(" L ")} L ${xFor(n - 1)},${padT + innerH} Z`
      : "";

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full min-w-[320px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="#E8E1D2"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={yFor(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#627072"
              fontFamily="var(--font-sans)"
            >
              {yLabels ? yLabels[t] ?? t : t}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={fillColor} />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {values.map((v, i) => {
          const isRuptura = rupturas?.includes(i);
          return (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(v)}
              r={isRuptura ? 4.5 : 3}
              fill={isRuptura ? COLOR.terracotta : color}
              stroke="white"
              strokeWidth={1.5}
            />
          );
        })}

        {labels.map((label, i) => (
          <text
            key={i}
            x={xFor(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#627072"
            fontFamily="var(--font-sans)"
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ============================================
// StackedBarChart genérico
// ============================================
export function StackedBarChart({
  labels,
  keys,
  keyLabels,
  keyColors,
  data,
  yTicks,
  yMax,
  ariaLabel,
  yFormatter,
}: {
  labels: string[];
  keys: string[];
  keyLabels: Record<string, string>;
  keyColors: Record<string, string>;
  data: Record<string, number>[];
  yTicks: number[];
  yMax: number;
  ariaLabel: string;
  yFormatter?: (v: number) => string;
}) {
  const W = 600;
  const H = 240;
  const padL = 36;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const slotW = innerW / n;
  const barW = Math.min(36, slotW * 0.6);

  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          className="h-auto w-full min-w-[320px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="#E8E1D2"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={yFor(t) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {yFormatter ? yFormatter(t) : t}
              </text>
            </g>
          ))}

          {data.map((row, i) => {
            const cx = padL + slotW * i + slotW / 2;
            let stackTop = yMax;
            return (
              <g key={i}>
                {keys.map((k) => {
                  const v = row[k] ?? 0;
                  if (v === 0) return null;
                  const yTopBar = yFor(stackTop);
                  const yBottomBar = yFor(stackTop - v);
                  stackTop -= v;
                  return (
                    <rect
                      key={k}
                      x={cx - barW / 2}
                      y={yTopBar}
                      width={barW}
                      height={Math.max(0, yBottomBar - yTopBar)}
                      fill={keyColors[k]}
                    />
                  );
                })}
              </g>
            );
          })}

          {labels.map((label, i) => {
            const cx = padL + slotW * i + slotW / 2;
            return (
              <text
                key={i}
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {label}
              </text>
            );
          })}
        </svg>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-[11px] text-ink-500">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: keyColors[k] }}
            />
            {keyLabels[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

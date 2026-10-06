"use client";

// Los dos motores SVG del Recorrido y la tarjeta que los envuelve. El
// contrato de /progreso y las reglas que no dibujan viven en
// progreso-contrato.ts; los ejes, en ejes.tsx.
//
// Qué cambió respecto de la versión anterior: el eje X ya no es el número de
// sesión (S1…Sn) sino la fecha. Con 40 sesiones "S27" no significa nada para
// nadie, y el espaciado por índice miente sobre el tiempo — dos sesiones
// separadas por cuatro meses se dibujaban a la misma distancia que dos
// separadas por una semana. Ahora la X es proporcional al tiempo real.

import * as React from "react";

import { fechaCorta } from "@/lib/format";

import type { Lectura, TonoLectura } from "../progreso-lecturas";
import { EjeX, EjeY } from "./ejes";
import { etiquetasDeFechas, useAnchoGrafico } from "./medidas";
import {
  MAX_MARCADORES,
  segmentosDe,
  type BarraPorFecha,
  type PuntoLinea,
} from "./progreso-contrato";

// Los colores del sistema de diseño (src/app/globals.css) por su variable.
// mint, gray, violeta y arena no tienen token: son la paleta categórica de
// las intervenciones y quedan escritos acá hasta que el sistema la tenga.
export const COLOR = {
  sage: "var(--color-sage-500)",
  sageSoft: "var(--color-sage-200)",
  terracotta: "var(--color-terracotta-500)",
  terracottaSoft: "var(--color-terracotta-100)",
  gold: "var(--color-gold-500)",
  inkSoft: "var(--color-ink-300)",
  mint: "#5DCAA5",
  gray: "#C2C8C9",
  violeta: "#7A6A9B",
  arena: "#C9A66B",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Card
// ────────────────────────────────────────────────────────────────────────────

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
    <section className="break-inside-avoid rounded-lg border border-[color:var(--border-subtle)] bg-white p-4 lg:p-5">
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

// ────────────────────────────────────────────────────────────────────────────
// Eje X por fecha
// ────────────────────────────────────────────────────────────────────────────

export function LineaPorFecha({
  puntos,
  yMin,
  yMax,
  yTicks,
  yLabels,
  color,
  fillColor,
  ariaLabel,
}: {
  puntos: PuntoLinea[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  /** Rótulo por valor del eje Y (alianza). Si falta se muestra el número. */
  yLabels?: Record<number, string>;
  color: string;
  fillColor: string;
  ariaLabel: string;
}) {
  const { ref, ancho: W } = useAnchoGrafico();
  const H = 220;
  const padL = yLabels ? 82 : 36;
  const padR = 16;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const base = padT + innerH;

  const tiempos = puntos.map((p) => p.fecha.getTime());
  const tMin = Math.min(...tiempos);
  const tMax = Math.max(...tiempos);
  const rango = tMax - tMin;

  // Sin rango temporal (una sola sesión, o todas el mismo día) el reparto por
  // tiempo no aplica: se reparten parejo para que se vean.
  const xFor = (i: number): number => {
    if (puntos.length === 1) return padL + innerW / 2;
    if (rango === 0) return padL + (i * innerW) / (puntos.length - 1);
    return padL + ((tiempos[i] - tMin) / rango) * innerW;
  };
  const yFor = (v: number): number =>
    padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const segmentos = segmentosDe(puntos);
  const conDato = puntos
    .map((p, i) => (p.valor === null ? -1 : i))
    .filter((i) => i >= 0);
  const primero = conDato[0];
  const ultimo = conDato[conDato.length - 1];
  const todosLosMarcadores = conDato.length <= MAX_MARCADORES;
  const etiquetas = etiquetasDeFechas(puntos.map((p) => p.fecha), puntos.map((_, i) => xFor(i)), padL, W - padR);

  return (
    <div ref={ref} className="min-w-0 w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        height={H}
        className="block w-full max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <EjeY ticks={yTicks} yFor={yFor} x1={padL} x2={W - padR} rotulos={yLabels} />

        {segmentos.map((indices, s) => {
          const puntosSvg = indices
            .map((i) => `${xFor(i)},${yFor(puntos[i].valor as number)}`)
            .join(" ");
          // Un tramo de un solo punto no dibuja línea ni área: solo su marcador.
          if (indices.length === 1) return null;
          const area = `M ${xFor(indices[0])},${base} L ${indices
            .map((i) => `${xFor(i)},${yFor(puntos[i].valor as number)}`)
            .join(" L ")} L ${xFor(indices[indices.length - 1])},${base} Z`;
          return (
            <g key={`seg-${s}`}>
              <path d={area} fill={fillColor} />
              <polyline
                points={puntosSvg}
                fill="none"
                stroke={color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {conDato.map((i) => {
          const punto = puntos[i];
          const destacado = punto.destacado === true;
          const visible =
            todosLosMarcadores || destacado || i === primero || i === ultimo;
          if (!visible) return null;
          return (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(punto.valor as number)}
              r={destacado ? 4.5 : 3}
              fill={destacado ? COLOR.terracotta : color}
              stroke="white"
              strokeWidth={1.5}
            >
              <title>{punto.detalle ?? fechaCorta(punto.fecha)}</title>
            </circle>
          );
        })}

        <EjeX etiquetas={etiquetas} y={H - 8} />
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Barras apiladas por sesión, rotuladas por fecha
// ────────────────────────────────────────────────────────────────────────────

export function BarrasPorFecha({
  barras,
  claves,
  etiquetas,
  colores,
  yTicks,
  yMax,
  ariaLabel,
}: {
  barras: BarraPorFecha[];
  claves: string[];
  etiquetas: Record<string, string>;
  colores: Record<string, string>;
  yTicks: number[];
  yMax: number;
  ariaLabel: string;
}) {
  const { ref, ancho: W } = useAnchoGrafico();
  const H = 240;
  const padL = 36;
  const padR = 16;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(1, barras.length);
  const slotW = innerW / n;
  const barW = Math.min(36, slotW * 0.6);
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;
  const rotulos = etiquetasDeFechas(barras.map((b) => b.fecha), barras.map((_, i) => padL + slotW * i + slotW / 2), padL, W - padR);

  return (
    <div>
      <div ref={ref} className="min-w-0 w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          height={H}
          className="block w-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <EjeY ticks={yTicks} yFor={yFor} x1={padL} x2={W - padR} />

          {barras.map((barra, i) => {
            const cx = padL + slotW * i + slotW / 2;
            let tope = 0;
            return (
              <g key={i}>
                <title>{barra.detalle ?? fechaCorta(barra.fecha)}</title>
                {claves.map((clave) => {
                  const v = barra.valores[clave] ?? 0;
                  if (v === 0) return null;
                  const yArriba = yFor(tope + v);
                  const yAbajo = yFor(tope);
                  tope += v;
                  return (
                    <rect
                      key={clave}
                      x={cx - barW / 2}
                      y={yArriba}
                      width={barW}
                      height={Math.max(0, yAbajo - yArriba)}
                      fill={colores[clave]}
                    />
                  );
                })}
              </g>
            );
          })}

          <EjeX etiquetas={rotulos} y={H - 8} />
        </svg>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {claves.map((clave) => (
          <li
            key={clave}
            className="flex items-center gap-1.5 text-[11px] text-ink-500"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: colores[clave] }}
            />
            {etiquetas[clave]}
          </li>
        ))}
      </ul>
    </div>
  );
}

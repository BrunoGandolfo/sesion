"use client";

// Tipos del payload de /progreso y los dos motores SVG del Recorrido.
//
// Qué cambió respecto de la versión anterior: el eje X ya no es el número de
// sesión (S1…Sn) sino la fecha. Con 40 sesiones "S27" no significa nada para
// nadie, y el espaciado por índice miente sobre el tiempo — dos sesiones
// separadas por cuatro meses se dibujaban a la misma distancia que dos
// separadas por una semana. Ahora la X es proporcional al tiempo real.
//
// Dos reglas que no se negocian:
//   - Un valor ausente NO se interpola. La línea se corta y se retoma en el
//     siguiente dato real (ver `segmentosDe`).
//   - Con más de 12 puntos los marcadores se reducen a los extremos y a las
//     sesiones con señal de riesgo, que nunca se ocultan.

import * as React from "react";

import { fechaCorta } from "@/lib/format";
import type { AlianzaTerapeutica, NivelRiesgo } from "@/types/domain";

import type { Lectura, TonoLectura } from "../progreso-lecturas";
import { SIN_DATO } from "./textos";
import { etiquetasDeFechas, useAnchoGrafico } from "./medidas";

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
  violeta: "#7A6A9B",
  arena: "#C9A66B",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Contrato de GET /api/pacientes/[id]/progreso?rango=
// ────────────────────────────────────────────────────────────────────────────

export type RangoProgreso = "10s" | "3m" | "6m" | "todo";

export const RANGOS: readonly RangoProgreso[] = ["10s", "3m", "6m", "todo"];

export function esRango(valor: string | null | undefined): valor is RangoProgreso {
  return valor === "10s" || valor === "3m" || valor === "6m" || valor === "todo";
}

export type TendenciaTema = "nuevo" | "sube" | "baja" | "estable";

/** Flags booleanos de la sesión. Se deja abierto porque el contrato de riesgo
 *  puede sumar señales y ninguna debe perderse por no estar enumerada acá. */
export type FlagsRiesgoProgreso = Record<string, boolean | undefined>;

export type SesionProgreso = {
  sesionId: string;
  fecha: string;
  numero: number;
  intensidadEmocional: number | null;
  /** Nivel de alianza tal como lo nombra el contrato ("fragil"…"fuerte"). */
  alianzaTerapeutica: AlianzaTerapeutica | null;
  temas: string[];
  nivelRiesgo: NivelRiesgo | null;
  flagsRiesgo: FlagsRiesgoProgreso;
  intervenciones: Record<string, number>;
  observacionIA: string | null;
  progresoPercibido: string | null;
};

export type TemaProgreso = {
  tema: string;
  conteo: number;
  deTotal: number;
  primeraVez: string;
  ultimaVez: string;
  tendencia: TendenciaTema;
};

export type RiesgoProgreso = {
  sesionId: string;
  fecha: string;
  flag: string;
  nivel: NivelRiesgo | null;
  cita: string | null;
};

export type ProgresoResponse = {
  pacienteId: string;
  totalSesiones: number;
  rango: RangoProgreso;
  sesiones: SesionProgreso[];
  temas: TemaProgreso[];
  riesgos: RiesgoProgreso[];
};

// ────────────────────────────────────────────────────────────────────────────
// Alianza terapéutica: nombre y orden
// El nombre es el clínico y no se traduce. El orden 1..4 existe solo para
// poder dibujar una línea; el eje se rotula con los nombres, no con números.
// ────────────────────────────────────────────────────────────────────────────

export const NOMBRE_ALIANZA: Record<AlianzaTerapeutica, string> = {
  fragil: "Frágil",
  inestable: "Inestable",
  estable: "Estable",
  fuerte: "Fuerte",
};

const ORDEN_ALIANZA: Record<AlianzaTerapeutica, number> = {
  fragil: 1,
  inestable: 2,
  estable: 3,
  fuerte: 4,
};

export function nivelDeAlianza(
  valor: AlianzaTerapeutica | null | undefined,
): number | null {
  if (!valor) return null;
  return ORDEN_ALIANZA[valor] ?? null;
}

/** Una sesión tiene señal si el nivel graduado no es "ninguno" o si algún
 *  flag booleano está activo. Las dos vías cuentan: el contrato de riesgo
 *  las mantiene separadas y ninguna se descarta. */
export function tieneSenal(sesion: SesionProgreso): boolean {
  if (sesion.nivelRiesgo !== null && sesion.nivelRiesgo !== "ninguno") {
    return true;
  }
  return Object.values(sesion.flagsRiesgo ?? {}).some((v) => v === true);
}

export function fechaDe(sesion: { fecha: string }): Date {
  return new Date(sesion.fecha);
}

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

// ────────────────────────────────────────────────────────────────────────────
// Eje X por fecha
// ────────────────────────────────────────────────────────────────────────────

/** Cuántas etiquetas de fecha entran sin encimarse en 600px de ancho. */
const MAX_ETIQUETAS_X = 5;

/** Índices que llevan etiqueta: siempre el primero y el último, y hasta tres
 *  intermedios repartidos parejo. Con 40 sesiones el eje dice cinco fechas,
 *  no cuarenta. */
export function indicesConEtiqueta(cantidad: number): number[] {
  if (cantidad <= 0) return [];
  if (cantidad <= MAX_ETIQUETAS_X) {
    return Array.from({ length: cantidad }, (_, i) => i);
  }
  const paso = (cantidad - 1) / (MAX_ETIQUETAS_X - 1);
  const indices = new Set<number>();
  for (let i = 0; i < MAX_ETIQUETAS_X; i++) {
    indices.add(Math.round(i * paso));
  }
  return [...indices].sort((a, b) => a - b);
}

/** Más de esto y los marcadores se reducen a extremos + señales de riesgo. */
export const MAX_MARCADORES = 12;

export type PuntoLinea = {
  fecha: Date;
  /** null = la sesión no registró el dato. No se interpola. */
  valor: number | null;
  /** Se dibuja siempre, aunque el resto de los marcadores esté oculto. */
  destacado?: boolean;
  /** Texto del <title> del marcador (lectura al pasar o al tocar). */
  detalle?: string;
};

/** Tramos consecutivos con dato. Cada corte es una sesión sin registro. */
function segmentosDe(puntos: PuntoLinea[]): number[][] {
  const segmentos: number[][] = [];
  let actual: number[] = [];
  puntos.forEach((punto, i) => {
    if (punto.valor === null) {
      if (actual.length > 0) segmentos.push(actual);
      actual = [];
      return;
    }
    actual.push(i);
  });
  if (actual.length > 0) segmentos.push(actual);
  return segmentos;
}

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
              fontSize="12"
              fill="#627072"
              fontFamily="var(--font-sans)"
            >
              {yLabels?.[t] ?? t}
            </text>
          </g>
        ))}

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

        {etiquetas.map(({ indice, texto, x }) => (
          <text
            key={`x-${indice}`}
            data-eje="x"
            x={x}
            y={H - 8}
            textAnchor="middle"
            fontSize="12"
            fill="#627072"
            fontFamily="var(--font-sans)"
          >
            {texto}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Barras apiladas por sesión, rotuladas por fecha
// ────────────────────────────────────────────────────────────────────────────

export type BarraPorFecha = {
  fecha: Date;
  valores: Record<string, number>;
  detalle?: string;
};

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
                fontSize="12"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {t}
              </text>
            </g>
          ))}

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

          {rotulos.map(({ indice, texto, x }) => {
            return (
              <text
                key={`x-${indice}`}
                data-eje="x"
                x={x}
                y={H - 8}
                textAnchor="middle"
                fontSize="12"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {texto}
              </text>
            );
          })}
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

/** Texto del <title> de un marcador: "4 mar · 7 de 10" o "4 mar · Sin dato". */
export function detalleDePunto(
  fecha: Date,
  valor: string | null,
): string {
  return `${fechaCorta(fecha)} · ${valor ?? SIN_DATO}`;
}

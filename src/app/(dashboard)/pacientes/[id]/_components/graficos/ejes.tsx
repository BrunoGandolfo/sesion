// Los dos ejes de los gráficos del Recorrido, compartidos por la línea y las
// barras: el Y con su grilla y el X con las fechas que entran sin pisarse
// (etiquetasDeFechas). Colores desde los tokens: la grilla es el borde sutil
// (cream-200) y los rótulos, el texto meta (ink-500).

import type { etiquetasDeFechas } from "./medidas";

type EtiquetaFecha = ReturnType<typeof etiquetasDeFechas>[number];

const GRILLA = "var(--color-cream-200)";
const ROTULO = "var(--color-ink-500)";

/** Líneas de la grilla con su rótulo a la izquierda del área. */
export function EjeY({
  ticks,
  yFor,
  x1,
  x2,
  rotulos,
}: {
  ticks: number[];
  yFor: (valor: number) => number;
  x1: number;
  x2: number;
  /** Rótulo por valor (alianza). Si falta se muestra el número. */
  rotulos?: Record<number, string>;
}) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x1} x2={x2} y1={yFor(t)} y2={yFor(t)} stroke={GRILLA} strokeWidth={1} />
          <text
            x={x1 - 8}
            y={yFor(t) + 4}
            textAnchor="end"
            fontSize="12"
            fill={ROTULO}
            fontFamily="var(--font-sans)"
          >
            {rotulos?.[t] ?? t}
          </text>
        </g>
      ))}
    </>
  );
}

/** Las fechas debajo del área, en la altura `y`. */
export function EjeX({ etiquetas, y }: { etiquetas: EtiquetaFecha[]; y: number }) {
  return (
    <>
      {etiquetas.map(({ indice, texto, x }) => (
        <text
          key={`x-${indice}`}
          data-eje="x"
          x={x}
          y={y}
          textAnchor="middle"
          fontSize="12"
          fill={ROTULO}
          fontFamily="var(--font-sans)"
        >
          {texto}
        </text>
      ))}
    </>
  );
}

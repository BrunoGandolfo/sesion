"use client";

import { lecturaIntervenciones } from "../progreso-lecturas";
import {
  COLOR,
  ChartCard,
  StackedBarChart,
  sessionLabels,
  type SesionProgreso,
} from "./base";

// ============================================
// 4. Intervenciones (StackedBarChart)
// ============================================
const INTERVENCION_COLORS: Record<string, string> = {
  validacion: COLOR.sage,
  reformulacion: COLOR.gold,
  senalamiento: COLOR.mint,
  confrontacion: COLOR.terracotta,
  otros: COLOR.gray,
};

const INTERVENCION_LABELS: Record<string, string> = {
  validacion: "Validación",
  reformulacion: "Reformulación",
  senalamiento: "Señalamiento",
  confrontacion: "Confrontación",
  otros: "Otros",
};

function normalizeKey(k: string): string {
  const lower = k.toLowerCase();
  if (lower in INTERVENCION_COLORS) return lower;
  return "otros";
}

export function IntervencionesChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const aggregated = sesiones.map((s) => {
    const buckets: Record<string, number> = {
      validacion: 0,
      reformulacion: 0,
      senalamiento: 0,
      confrontacion: 0,
      otros: 0,
    };
    for (const [k, v] of Object.entries(s.intervenciones ?? {})) {
      buckets[normalizeKey(k)] += v;
    }
    return buckets;
  });

  const totals = aggregated.map((b) => Object.values(b).reduce((a, b) => a + b, 0));
  const maxTotal = Math.max(...totals, 1);
  const tickStep = Math.max(1, Math.ceil(maxTotal / 4));
  const yTop = Math.ceil(maxTotal / tickStep) * tickStep;
  const yTicks: number[] = [];
  for (let v = 0; v <= yTop; v += tickStep) yTicks.push(v);

  const keys = ["validacion", "reformulacion", "senalamiento", "confrontacion", "otros"];
  const labels = sessionLabels(sesiones);
  const lectura = lecturaIntervenciones(aggregated, INTERVENCION_LABELS);

  return (
    <ChartCard
      title="Intervenciones del terapeuta"
      subtitle="Cantidad y tipo de intervenciones por sesión."
      lectura={lectura}
    >
      <StackedBarChart
        labels={labels}
        keys={keys}
        keyLabels={INTERVENCION_LABELS}
        keyColors={INTERVENCION_COLORS}
        data={aggregated}
        yTicks={yTicks}
        yMax={yTop}
        ariaLabel="Intervenciones por sesión"
      />
    </ChartCard>
  );
}

"use client";

import { lecturaAlianza } from "../progreso-lecturas";
import { COLOR, ChartCard, LineChart, sessionLabels, type SesionProgreso } from "./base";

// ============================================
// 2. Alianza terapéutica (LineChart)
// ============================================
const ALIANZA_LABELS = ["", "Frágil", "Inestable", "Estable", "Fuerte"];

export function AlianzaChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const values = sesiones.map((s) => s.alianzaTerapeutica);
  const labels = sessionLabels(sesiones);
  const drops: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) drops.push(i);
  }
  const lectura = lecturaAlianza(
    sesiones.map((s) => ({
      nivel: s.alianzaTerapeutica,
      etiqueta: s.alianzaLabel,
    })),
  );

  return (
    <ChartCard
      title="Alianza terapéutica"
      subtitle="Calidad del vínculo en cada sesión. Las caídas marcadas en terracotta son posibles rupturas."
      lectura={lectura}
    >
      <LineChart
        values={values}
        labels={labels}
        yMin={1}
        yMax={4}
        yTicks={[1, 2, 3, 4]}
        yLabels={ALIANZA_LABELS}
        color={COLOR.sage}
        fillColor="rgba(79,122,106,0.12)"
        rupturas={drops}
        ariaLabel="Alianza terapéutica por sesión"
      />
    </ChartCard>
  );
}

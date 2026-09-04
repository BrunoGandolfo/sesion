"use client";

import { lecturaIntensidad } from "../progreso-lecturas";
import { COLOR, ChartCard, LineChart, sessionLabels, type SesionProgreso } from "./base";

// ============================================
// 1. Intensidad emocional (LineChart)
// ============================================
export function IntensidadChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const values = sesiones.map((s) => s.intensidadEmocional);
  const labels = sessionLabels(sesiones);
  const lectura = lecturaIntensidad(values);

  return (
    <ChartCard
      title="Intensidad emocional"
      subtitle="Cómo se siente al iniciar cada sesión (1 a 10). La baja sostenida indica mejora."
      lectura={lectura}
    >
      <LineChart
        values={values}
        labels={labels}
        yMin={0}
        yMax={10}
        yTicks={[0, 2, 4, 6, 8, 10]}
        color={COLOR.terracotta}
        fillColor={COLOR.terracottaSoft}
        ariaLabel="Intensidad emocional por sesión"
      />
    </ChartCard>
  );
}

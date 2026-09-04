"use client";

import { INTENSIDAD_EMOCIONAL } from "@/lib/glosario";

import { lecturaIntensidad } from "../progreso-lecturas";
import {
  COLOR,
  ChartCard,
  LineaPorFecha,
  detalleDePunto,
  fechaDe,
  tieneSenal,
  type SesionProgreso,
} from "./base";
import { HUECOS_EXPLICADOS, SUBTITULO_INTENSIDAD } from "./textos";

/** Intensidad emocional (1 a 10) por fecha. Las sesiones con señal de riesgo
 *  se marcan siempre, aunque el resto de los marcadores esté oculto por
 *  cantidad: una señal no se pierde por una regla de densidad. */
export function IntensidadChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const puntos = sesiones.map((s) => ({
    fecha: fechaDe(s),
    valor: s.intensidadEmocional,
    destacado: tieneSenal(s),
    detalle: detalleDePunto(
      fechaDe(s),
      s.intensidadEmocional === null ? null : `${s.intensidadEmocional} de 10`,
    ),
  }));

  const hayHuecos = puntos.some((p) => p.valor === null);
  const lectura = lecturaIntensidad(puntos.map((p) => p.valor));

  return (
    <ChartCard
      title={INTENSIDAD_EMOCIONAL}
      subtitle={SUBTITULO_INTENSIDAD}
      lectura={lectura}
    >
      <LineaPorFecha
        puntos={puntos}
        yMin={0}
        yMax={10}
        yTicks={[0, 2, 4, 6, 8, 10]}
        color={COLOR.terracotta}
        fillColor={COLOR.terracottaSoft}
        ariaLabel={`${INTENSIDAD_EMOCIONAL} por fecha`}
      />
      {hayHuecos ? (
        <p className="mt-2 text-[11px] leading-[1.45] text-ink-500">
          {HUECOS_EXPLICADOS}
        </p>
      ) : null}
    </ChartCard>
  );
}

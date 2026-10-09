// Temas del período en el papel: la misma tarjeta y la misma lectura que la
// pantalla (ChartCard, lecturaTemas), pero con TODOS los temas —la pantalla
// deja los que pasan de ocho detrás de "Ver detalle", que no se imprime— y
// con la última vez que apareció cada uno, en hora de Montevideo.

import { lecturaTemas } from "@/app/(dashboard)/pacientes/[id]/_components/progreso-lecturas";
import { ChartCard } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/base";
import type { SesionProgreso, TemaProgreso } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/progreso-contrato";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { DESDE, SUBTITULO_TEMAS, TEMAS, TENDENCIA_LABEL, pluralizar } from "@/lib/glosario";

import { diaCorto } from "./formato";

const TONO_TENDENCIA: Record<TemaProgreso["tendencia"], string> = {
  nuevo: "text-sage-700",
  sube: "text-terracotta-600",
  baja: "text-ink-500",
  estable: "text-ink-500",
};

export function TemasDelPeriodo({ temas, sesiones }: { temas: TemaProgreso[]; sesiones: SesionProgreso[] }) {
  if (temas.length === 0) {
    return (
      <ChartCard title={TEMAS} subtitle={SUBTITULO_TEMAS}>
        <p className="py-4 text-center text-[10pt] text-ink-500">Aún no hay temas registrados en este período.</p>
      </ChartCard>
    );
  }
  return (
    <ChartCard title={TEMAS} subtitle={SUBTITULO_TEMAS} lectura={lecturaTemas(sesiones.map((s) => s.temas ?? []))}>
      {/* data-temas-papel: la tarjeta se parte entre filas (impresion.css). */}
      <ul data-temas-papel>
        {temas.map((tema) => (
          <li key={tema.tema} className="flex break-inside-avoid items-baseline justify-between gap-3 border-t border-cream-200 py-1.5 first:border-t-0">
            <span className="text-[10pt] text-ink-900">{formatearEtiqueta(tema.tema)}</span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-2 text-[9pt] tabular-nums text-ink-500">
              <span>{tema.conteo} de {pluralizar(tema.deTotal, "sesión", "sesiones")}</span>
              <span aria-hidden="true">·</span>
              <span className={TONO_TENDENCIA[tema.tendencia]}>{TENDENCIA_LABEL[tema.tendencia]}</span>
              <span aria-hidden="true">·</span>
              <span>{DESDE} {diaCorto(tema.primeraVez)}</span>
              <span aria-hidden="true">·</span>
              <span>última vez {diaCorto(tema.ultimaVez)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

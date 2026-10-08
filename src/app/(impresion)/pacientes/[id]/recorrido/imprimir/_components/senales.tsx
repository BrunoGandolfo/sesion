// Señales de riesgo en el papel: la misma línea de tiempo que la pantalla
// (FlagsRiesgoTimeline, graficos/), todas las señales y la más reciente
// primero, pero con la cita de la paciente a la vista. En la pantalla la cita
// va detrás de "Lo que dijo", un botón que en el papel no se puede tocar: sin
// esto la hoja perdía la frase que sostiene la señal.

import { AlertTriangle } from "lucide-react";

import type { RiesgoProgreso } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/progreso-contrato";
import { Chip } from "@/components/ui";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { SENAL_DE_RIESGO, SUBTITULO_SENALES, pluralizar } from "@/lib/glosario";

import { dia } from "./formato";

export function SenalesDelPeriodo({ riesgos }: { riesgos: RiesgoProgreso[] }) {
  const ordenados = [...riesgos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (ordenados.length === 0) return null;

  return (
    <section className="break-inside-avoid rounded-md border border-terracotta-100 bg-terracotta-50 p-4">
      <header className="mb-4 flex break-after-avoid items-start gap-2">
        <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" className="mt-[3px] shrink-0 text-terracotta-500" />
        <div>
          <h3 className="font-display text-[13.5pt] font-medium leading-tight text-ink-900">
            {SENAL_DE_RIESGO} · {pluralizar(ordenados.length, "señal", "señales")}
          </h3>
          <p className="mt-1 text-[9pt] leading-[1.4] text-ink-500">{SUBTITULO_SENALES}</p>
        </div>
      </header>

      <ol className="flex flex-col gap-2">
        {ordenados.map((riesgo, indice) => {
          const cita = riesgo.cita?.trim();
          return (
            <li key={`${riesgo.sesionId}-${riesgo.flag}-${indice}`} className="break-inside-avoid rounded-md border border-terracotta-100 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[10pt] font-semibold tabular-nums text-ink-900">{dia(riesgo.fecha)}</span>
                <Chip variant="terracotta" size="sm">{formatearEtiqueta(riesgo.flag)}</Chip>
                {riesgo.nivel && riesgo.nivel !== "ninguno" ? (
                  <span className="text-[9pt] text-terracotta-600">nivel {riesgo.nivel}</span>
                ) : null}
              </div>
              {cita ? (
                <p className="mt-2 border-l-2 border-terracotta-100 pl-3 font-display text-[11pt] italic leading-[1.5] text-ink-900">«{cita}»</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

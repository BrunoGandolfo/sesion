"use client";

import * as React from "react";
import { agregarDiasMvd, esMismoDiaMvd, inicioDeSemanaMvd, partesMvd } from "@/lib/fechas-montevideo";
import type { TurnoConPaciente } from "@/types/domain";

import { PuntosDelDia, etiquetaDelDia } from "./month-view";
import { INICIALES_DIAS, TIRA_SEMANA } from "./textos";

interface Props {
  /** El día elegido: la tira muestra su semana, de lunes a domingo. */
  anchor: Date;
  today: Date;
  /** Los turnos de esa semana; alcanza con esos. */
  turnos: TurnoConPaciente[];
  onDayClick: (day: Date) => void;
}

/**
 * La semana del día elegido, en el teléfono, cuando el mes está plegado:
 * siete días tocables con su inicial, su número y sus puntos. Cambiar de día
 * sin abrir el mes, que es lo que se hace entre pacientes.
 */
export function SemanaTira({ anchor, today, turnos, onDayClick }: Props) {
  const lunes = inicioDeSemanaMvd(anchor);
  const dias = Array.from({ length: 7 }, (_, i) => agregarDiasMvd(lunes, i));

  return (
    <div role="group" aria-label={TIRA_SEMANA} className="grid grid-cols-7 gap-1">
      {dias.map((dia, idx) => {
        const elegido = esMismoDiaMvd(dia, anchor);
        const esHoy = esMismoDiaMvd(dia, today);
        const delDia = turnos.filter((t) => esMismoDiaMvd(t.fecha, dia));
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onDayClick(dia)}
            aria-pressed={elegido}
            aria-current={esHoy ? "date" : undefined}
            aria-label={etiquetaDelDia(dia, delDia.length)}
            className={`flex min-h-[64px] min-w-0 flex-col items-center gap-1 rounded-md border py-2 transition-colors duration-[var(--duration-fast)] ${
              elegido
                ? "border-sage-500 bg-sage-50"
                : "border-transparent hover:bg-cream-50"
            }`}
          >
            <span className="text-[11px] font-semibold uppercase leading-none text-ink-500">
              {INICIALES_DIAS[idx]}
            </span>
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full tabular-nums text-[15px] font-medium leading-none ${
                esHoy ? "bg-sage-500 text-white" : "text-ink-900"
              }`}
            >
              {partesMvd(dia).dia}
            </span>
            <PuntosDelDia turnos={delDia} className="min-h-[6px] justify-center" />
          </button>
        );
      })}
    </div>
  );
}

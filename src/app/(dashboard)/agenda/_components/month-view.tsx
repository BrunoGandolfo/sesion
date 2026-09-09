"use client";

import * as React from "react";
import {
  addDays,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { AGENDADO, MES_LEYENDA, PAGADO } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

interface Props {
  anchor: Date;
  today: Date;
  turnos: TurnoConPaciente[];
  onDayClick: (day: Date) => void;
}

const WEEK_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export function MonthView({ anchor, today, turnos, onDayClick }: Props) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white">
      <div className="grid grid-cols-7 bg-cream-50">
        {WEEK_LABELS.map((d, idx) => (
          <div
            key={d}
            className={`py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${
              idx === 0 ? "" : "border-l border-[color:var(--border-subtle)]"
            }`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          const turnosDia = turnos.filter((t) => isSameDay(t.fecha, day));
          const visibles = turnosDia.slice(0, 3);
          const overflow = turnosDia.length - visibles.length;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onDayClick(day)}
              className={`flex min-h-[48px] flex-col gap-1 border-t border-[color:var(--border-subtle)] p-2 text-left transition-colors duration-150 hover:bg-cream-50 lg:min-h-[56px] ${
                idx % 7 !== 0
                  ? "border-l border-[color:var(--border-subtle)]"
                  : ""
              } ${!inMonth ? "opacity-30" : ""}`}
            >
              {isToday ? (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sage-500 font-[family-name:var(--font-display)] text-[14px] font-medium leading-none text-white">
                  {day.getDate()}
                </span>
              ) : (
                <span className="text-[14px] font-medium leading-none text-ink-900">
                  {day.getDate()}
                </span>
              )}
              {turnosDia.length > 0 ? (
                <div className="mt-auto flex items-center gap-1">
                  {visibles.map((t) => (
                    <span
                      key={t.id}
                      aria-hidden="true"
                      className={`h-[6px] w-[6px] rounded-full ${
                        t.pagoEstado === "pagado"
                          ? "bg-sage-500"
                          : "bg-gold-500"
                      }`}
                    />
                  ))}
                  {overflow > 0 ? (
                    <span className="text-[9px] leading-none text-ink-500">
                      +{overflow}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      <Leyenda />
    </div>
  );
}

/**
 * Qué significan el punto dorado y el verde. La grilla no dice otra cosa que
 * puntos, y el código de color —dorado agendado, verde pagado— sólo estaba
 * escrito en session-row, tres pantallas más allá
 * (docs/diseno/01-auditoria-frontend.md, sección 2).
 */
function Leyenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[color:var(--border-subtle)] bg-cream-50 px-3 py-2 text-[11px] text-ink-500">
      <span>{MES_LEYENDA}</span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-gold-500" />
        {AGENDADO}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-sage-500" />
        {PAGADO}
      </span>
    </div>
  );
}

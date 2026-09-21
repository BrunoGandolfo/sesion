"use client";

import * as React from "react";
import { agregarDiasMvd, esMismoDiaMvd, esMismoMesMvd, inicioDeMesMvd, inicioDeSemanaMvd, partesMvd } from "@/lib/fechas-montevideo";
import { fechaLarga } from "@/lib/format";

import { AGENDADO, MES_LEYENDA, MES_LEYENDA_SIN_SESION, PAGADO } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

interface Props {
  anchor: Date;
  today: Date;
  turnos: TurnoConPaciente[];
  onDayClick: (day: Date) => void;
}

const WEEK_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export function MonthView({ anchor, today, turnos, onDayClick }: Props) {
  const gridStart = inicioDeSemanaMvd(inicioDeMesMvd(anchor));
  const days = Array.from({ length: 42 }, (_, i) => agregarDiasMvd(gridStart, i));

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
          const inMonth = esMismoMesMvd(day, anchor);
          const isToday = esMismoDiaMvd(day, today);
          const turnosDia = turnos.filter((t) => esMismoDiaMvd(t.fecha, day));
          const visibles = turnosDia.slice(0, 3);


          return (
            <button
              key={idx}
              type="button"
              onClick={() => onDayClick(day)}
              aria-label={fechaLarga(day) + ": " + turnosDia.length + (turnosDia.length === 1 ? " turno" : " turnos")}
              className={`flex min-h-[48px] flex-col gap-1 border-t border-[color:var(--border-subtle)] p-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 lg:min-h-[56px] ${
                idx % 7 !== 0
                  ? "border-l border-[color:var(--border-subtle)]"
                  : ""
              } ${!inMonth ? "opacity-30" : ""}`}
            >
              {isToday ? (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sage-500 tabular-nums text-[14px] font-medium leading-none text-white">
                  {partesMvd(day).dia}
                </span>
              ) : (
                <span className="tabular-nums text-[14px] font-medium leading-none text-ink-900">
                  {partesMvd(day).dia}
                </span>
              )}
              {turnosDia.length > 0 ? (
                <div className="mt-auto flex flex-wrap items-center gap-1">
                  <span className="tabular-nums text-[12px] font-semibold leading-none text-ink-700">{turnosDia.length}</span>
                  {visibles.map((t) => (
                    <span
                      key={t.id}
                      aria-hidden="true"
                      className={`h-[6px] w-[6px] rounded-full ${
                        t.estado === "ausente" || t.estado === "cancelado"
                          ? "bg-ink-300"
                          : t.pagoEstado === "pagado"
                            ? "bg-sage-500"
                            : "bg-ink-500"
                      }`}
                    />
                  ))}

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
        <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-ink-500" />
        {AGENDADO}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-sage-500" />
        {PAGADO}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-ink-300" />
        {MES_LEYENDA_SIN_SESION}
      </span>
    </div>
  );
}

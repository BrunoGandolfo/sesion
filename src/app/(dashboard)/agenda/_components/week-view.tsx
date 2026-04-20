"use client";

import * as React from "react";
import { addDays, isSameDay, startOfWeek } from "date-fns";
import type { TurnoConPaciente } from "@/types/domain";
import { hora } from "@/lib/format";

interface Props {
  anchor: Date;
  today: Date;
  turnos: TurnoConPaciente[];
  onEventClick: (turno: TurnoConPaciente) => void;
}

const DAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const START_HOUR = 8;
const END_HOUR = 21;
const ROW_HEIGHT = 44;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

export function WeekView({ anchor, today, turnos, onEventClick }: Props) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const turnosPorDia = days.map((day) =>
    turnos
      .filter((t) => isSameDay(t.fecha, day))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white">
      <div className="overflow-x-auto">
        <div>
          {/* Header */}
          <div className="flex bg-cream-50">
            <div className="w-[60px] shrink-0" aria-hidden="true" />
            {days.map((day, i) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={i}
                  className="flex flex-1 flex-col items-center gap-1 border-l border-[color:var(--border-subtle)] px-2 py-3"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    {DAY_LABELS[i]}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-[family-name:var(--font-display)] text-[18px] font-medium leading-none tabular-nums ${
                        isToday ? "text-sage-600" : "text-ink-900"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {isToday ? (
                      <span
                        aria-hidden="true"
                        className="h-[6px] w-[6px] rounded-full bg-sage-500"
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Body */}
          <div className="flex">
            {/* Hours column */}
            <div className="w-[60px] shrink-0">
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: ROW_HEIGHT }}
                  className="border-t border-[color:var(--border-subtle)] px-2 py-[6px]"
                >
                  <span className="text-[10px] text-ink-300 tabular-nums">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((day, i) => (
              <div
                key={i}
                className="relative flex-1 border-l border-[color:var(--border-subtle)]"
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    style={{ height: ROW_HEIGHT }}
                    className="border-t border-[color:var(--border-subtle)]"
                  />
                ))}
                {turnosPorDia[i].map((turno) => {
                  const minutes =
                    turno.fecha.getHours() * 60 +
                    turno.fecha.getMinutes() -
                    START_HOUR * 60;
                  const top = (minutes / 60) * ROW_HEIGHT;
                  const height = Math.max(
                    28,
                    (turno.duracion / 60) * ROW_HEIGHT,
                  );
                  const isPresencial = turno.modalidad === "presencial";
                  return (
                    <button
                      key={turno.id}
                      type="button"
                      onClick={() => onEventClick(turno)}
                      style={{ top, height }}
                      className={`absolute left-[2px] right-[2px] overflow-hidden rounded-sm border-l-[3px] px-2 py-1 text-left text-[12px] transition-[box-shadow] duration-150 hover:ring-2 hover:ring-sage-300 ${
                        isPresencial
                          ? "bg-sage-100 border-l-sage-500"
                          : "bg-gold-50 border-l-gold-500"
                      }`}
                      aria-label={`${turno.paciente.nombre} ${turno.paciente.apellido} ${hora(turno.fecha)}`}
                    >
                      <span className="block truncate font-semibold text-ink-900">
                        {turno.paciente.nombre} {turno.paciente.apellido}
                      </span>
                      <span className="block truncate text-[10px] text-ink-500 tabular-nums">
                        {hora(turno.fecha)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { isSameDay } from "date-fns";
import { SessionRow } from "@/components/ui";
import type { TurnoConPaciente } from "@/types/domain";

interface Props {
  date: Date;
  turnos: TurnoConPaciente[];
  onOpenTurno: (turno: TurnoConPaciente) => void;
}

export function DayView({ date, turnos, onOpenTurno }: Props) {
  const delDia = React.useMemo(
    () =>
      turnos
        .filter((t) => isSameDay(t.fecha, date))
        .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
    [turnos, date],
  );

  if (delDia.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-10 text-center text-[14px] text-ink-500">
        Nada agendado este día.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {delDia.map((turno) => (
        <SessionRow
          key={turno.id}
          turno={turno}
          onClick={() => onOpenTurno(turno)}
        />
      ))}
    </div>
  );
}

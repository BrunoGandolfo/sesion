"use client";

import * as React from "react";
import { isSameDay } from "date-fns";
import { CalendarDays } from "lucide-react";

import { Button, SessionRow } from "@/components/ui";
import type { TurnoConPaciente } from "@/types/domain";

interface Props {
  date: Date;
  turnos: TurnoConPaciente[];
  onOpenTurno: (turno: TurnoConPaciente) => void;
  onNuevoTurno: () => void;
}

export function DayView({ date, turnos, onOpenTurno, onNuevoTurno }: Props) {
  const delDia = React.useMemo(
    () =>
      turnos
        .filter((t) => isSameDay(t.fecha, date))
        .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
    [turnos, date],
  );

  if (delDia.length === 0) {
    return (
      <EstadoVacio
        icono={<CalendarDays size={28} strokeWidth={1.6} aria-hidden="true" />}
        titulo="Nada agendado este día"
        lineas={[
          "Podés usarlo para vos o agendar un turno.",
          "Si el paciente ya vino, la app propone el mismo día y hora de la última vez.",
          "El recordatorio se programa solo al agendar.",
        ]}
        accion={{ label: "Agendar", onClick: onNuevoTurno }}
      />
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

/** Estado vacío de la agenda: ícono, titular, tres líneas, un botón. */
export function EstadoVacio({
  icono,
  titulo,
  lineas,
  accion,
}: {
  icono: React.ReactNode;
  titulo: string;
  lineas: [string, string, string];
  accion: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-12 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-sage-600">
        {icono}
      </span>
      <p className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        {titulo}
      </p>
      <div className="mt-3 flex max-w-[420px] flex-col gap-1">
        {lineas.map((linea) => (
          <p key={linea} className="text-[13px] leading-[1.5] text-ink-500">
            {linea}
          </p>
        ))}
      </div>
      <div className="mt-6">
        <Button variant="secondary" onClick={accion.onClick}>
          {accion.label}
        </Button>
      </div>
    </div>
  );
}

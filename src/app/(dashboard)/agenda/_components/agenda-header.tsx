"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, endOfWeek, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { Button, Segmented } from "@/components/ui";
import { fechaCorta, fechaLarga } from "@/lib/format";
import type { AgendaViewMode } from "./agenda-view";

interface Props {
  view: AgendaViewMode;
  onViewChange: (v: AgendaViewMode) => void;
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewTurno: () => void;
}

const VIEW_OPTIONS: { value: AgendaViewMode; label: string }[] = [
  { value: "día", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
];

function rangeLabelFor(view: AgendaViewMode, anchor: Date): string {
  if (view === "día") return fechaLarga(anchor);
  if (view === "semana") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return `${fechaCorta(start)} — ${fechaCorta(end)}`;
  }
  return format(anchor, "MMMM yyyy", { locale: es });
}

export function AgendaHeader({
  view,
  onViewChange,
  anchor,
  onPrev,
  onNext,
  onToday,
  onNewTurno,
}: Props) {
  const label = rangeLabelFor(view, anchor);

  return (
    <header>
      <h1 className="lg:hidden mb-4 font-[family-name:var(--font-display)] text-[30px] font-medium leading-none text-ink-900">
        Agenda
      </h1>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrev}
              aria-label="Anterior"
              icon={<ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />}
            />
            <Button variant="secondary" size="sm" onClick={onToday}>
              Hoy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              aria-label="Siguiente"
              icon={<ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />}
            />
          </div>
          <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[16px] font-medium leading-tight text-ink-900 lg:flex-none lg:whitespace-nowrap lg:text-[20px] lg:leading-none">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={onViewChange}
            ariaLabel="Modo de vista"
          />
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
            onClick={onNewTurno}
            className="hidden lg:inline-flex"
          >
            Nuevo turno
          </Button>
        </div>
      </div>
    </header>
  );
}
